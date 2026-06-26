import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { GeyserStream } from "./stream/geyser.js";
import { TipEngine } from "./tip/engine.js";
import { JitoClient } from "./jito/client.js";
import { classifyFailure, type FailureEvidence } from "./lifecycle/classifier.js";
import { RetryAgent, type AgentContext } from "./agent/agent.js";
import { FaultInjector } from "./fault/injector.js";
import { LogStore } from "./log/store.js";
import { DashboardServer, type DashEventType } from "./dashboard/server.js";
import type { AgentDecision, BundleAttempt, LifecycleEntry } from "./types.js";

/**
 * Campaign orchestrator.
 *
 * Control-flow invariant: this file holds NO retry policy. When an attempt
 * fails it is classified and handed to the agent; the agent's decision
 * (retry-with-changes or abort) is executed verbatim.
 */

const log = new LogStore();
const say = (msg: string) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
};

/** Live dashboard sink. No-ops until a server is attached via useDashboard(). */
let dash: DashboardServer | undefined;
const pub = (t: DashEventType, d: unknown) => dash?.publish(t, d);

/** Route campaign events to a dashboard server. Both entrypoints (the CLI here
 *  and the persistent serve.ts) call this before starting a run. */
export function useDashboard(d: DashboardServer): void {
  dash = d;
}

async function waitForLeaderWindow(
  jito: JitoClient,
  stream: GeyserStream
): Promise<{ slot: number; identity: string }> {
  for (;;) {
    let info: Awaited<ReturnType<JitoClient["nextScheduledLeader"]>>;
    try {
      info = await jito.nextScheduledLeader();
    } catch (err) {
      // Transient block-engine errors (ECONNRESET, 503, etc.) must not discard
      // a whole bundle — the leader lookup is pure read, so just retry it.
      say(`  leader lookup failed (${String(err).slice(0, 80)}) — retrying in 1.5s`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    const gap = info.nextLeaderSlot - info.currentSlot;
    pub("leader", {
      currentSlot: info.currentSlot,
      nextLeaderSlot: info.nextLeaderSlot,
      identity: info.nextLeaderIdentity,
      gap,
    });
    if (gap <= 8) {
      say(`leader window: slot ${info.nextLeaderSlot} (${gap} slots away, leader ${info.nextLeaderIdentity.slice(0, 8)}…)`);
      return { slot: info.nextLeaderSlot, identity: info.nextLeaderIdentity };
    }
    say(`holding: next Jito leader in ${gap} slots (~${Math.round(gap * 0.4)}s)`);
    await new Promise((r) => setTimeout(r, Math.min(gap * 400, 4000)));
  }
}

type StageName = "processed" | "confirmed" | "finalized";
interface Landing {
  landed: boolean;
  outcome?: StageName;
  txErr?: unknown;
  slot?: number;
}

const STAGE_LADDER: readonly StageName[] = ["processed", "confirmed", "finalized"];

/**
 * Authoritative landing detection: poll getSignatureStatuses from submit and
 * record the real wall-clock time each commitment level is first observed.
 *
 * Why poll instead of the gRPC tx-status stream: Yellowstone fires that update
 * at most once (at `processed`) and providers drop it (SolInfra missed 2/2 real
 * landings in testing), so a bundle can finalize while the stream stays silent.
 * Polling also preserves the processed→confirmed delta (Q1 evidence) and the
 * latency the dashboard charts, which a single post-timeout check would collapse
 * onto one timestamp.
 *
 * Phase 1 waits `processedTimeoutMs` for `processed` (absent ⇒ not landed);
 * phase 2 polls on for confirmed then finalized. `onStage` fires once per
 * newly-reached level.
 */
async function pollLanding(
  connection: Connection,
  signature: string,
  onStage: (stage: StageName, slot: number, at: number) => void,
  opts: { processedTimeoutMs: number; confirmTimeoutMs: number; finalizeTimeoutMs: number; intervalMs: number }
): Promise<Landing> {
  let best = 0; // 0=none, 1=processed, 2=confirmed, 3=finalized
  let slot = 0;
  const processedDeadline = Date.now() + opts.processedTimeoutMs;
  let phaseDeadline = processedDeadline;

  for (;;) {
    let st: { slot: number; err: unknown; confirmationStatus?: string } | null = null;
    try {
      const { value } = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      st = value[0] as any;
    } catch {
      /* transient RPC error — retry until the deadline */
    }

    if (st) {
      if (st.err) return { landed: false, txErr: st.err, slot: st.slot };
      slot = st.slot ?? slot;
      const lvl = STAGE_LADDER.indexOf((st.confirmationStatus as StageName) ?? "processed") + 1;
      // Emit every newly-reached level (the chain can jump processed→confirmed
      // between polls; we still record each, at the time we observe it).
      for (let l = best + 1; l <= lvl; l++) onStage(STAGE_LADDER[l - 1], slot, Date.now());
      if (lvl > best) {
        best = lvl;
        if (best === 1) phaseDeadline = Date.now() + opts.confirmTimeoutMs;
        if (best === 2) phaseDeadline = Date.now() + opts.finalizeTimeoutMs;
      }
      if (best === 3) return { landed: true, outcome: "finalized", slot };
    }

    const deadline = best === 0 ? processedDeadline : phaseDeadline;
    if (Date.now() >= deadline) {
      if (best === 0) return { landed: false }; // never processed → not landed
      return { landed: true, outcome: STAGE_LADDER[best - 1], slot };
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
}

async function runOne(opts: {
  index: number;
  injectFault: boolean;
  deps: {
    connection: Connection;
    payer: Keypair;
    stream: GeyserStream;
    jito: JitoClient;
    tips: TipEngine;
    agent: RetryAgent;
    injector: FaultInjector;
  };
}): Promise<LifecycleEntry> {
  const { connection, payer, stream, jito, tips, agent, injector } = opts.deps;

  const entry: LifecycleEntry = {
    id: randomUUID(),
    createdAt: Date.now(),
    network: config.network,
    attempts: [],
    outcome: "failed",
    agentDecisionIds: [],
  };

  let attempt = 1;
  let forcedTip: number | undefined;
  let injectThisAttempt = opts.injectFault;

  while (attempt <= config.maxAttempts) {
    const targetLeader = await waitForLeaderWindow(jito, stream);
    const targetLeaderSlot = targetLeader.slot;

    const bh = await connection.getLatestBlockhash("confirmed");
    const blockhashFetchedAtSlot = stream.currentSlot;

    const tipAccount = await jito.randomTipAccount();
    const tip = forcedTip
      ? { ...(await tips.decide(tipAccount)), lamports: forcedTip }
      : await tips.decide(tipAccount);

    const { bundle, signature } = jito.buildBundle({
      payer,
      blockhash: bh.blockhash,
      tipLamports: tip.lamports,
      tipAccount,
      memoTag: `${entry.id}:${attempt}`,
    });

    if (injectThisAttempt) {
      say(`bundle ${opts.index} attempt ${attempt}: FAULT INJECTION — holding signed tx until blockhash expires…`);
      await injector.holdUntilExpired(bh.blockhash, (valid) =>
        say(`  blockhash still valid: ${valid}`)
      );
      say("  blockhash now expired on-chain; submitting anyway (genuine failure incoming)");
    }

    const rec: BundleAttempt = {
      attempt,
      signature,
      blockhash: bh.blockhash,
      blockhashFetchedAtSlot,
      tip,
      targetLeaderSlot,
      targetLeaderIdentity: targetLeader.identity,
      stages: [],
      faultInjected: injectThisAttempt || undefined,
    };
    entry.attempts.push(rec);

    const submittedAt = Date.now();
    rec.stages = [{ stage: "submitted", observedAt: submittedAt }];

    let bundleId: string | undefined;
    let sendErr: unknown;
    try {
      bundleId = await jito.sendBundle(bundle);
      rec.bundleId = bundleId;
      say(`bundle ${opts.index} attempt ${attempt}: sent ${bundleId} sig=${signature.slice(0, 16)}… tip=${tip.lamports} (${tip.basis.formula})`);
    } catch (err) {
      sendErr = err;
      say(`bundle ${opts.index} attempt ${attempt}: sendBundle rejected: ${String(err)}`);
    }

    pub("attempt", {
      entryId: entry.id,
      index: opts.index,
      attempt,
      signature,
      bundleId,
      tipLamports: tip.lamports,
      tipAccount,
      basisFormula: tip.basis.formula,
      percentiles: { p50: tip.basis.landedTips50th, p99: tip.basis.landedTips99th },
      targetLeaderSlot,
      targetLeaderIdentity: targetLeader.identity,
      blockhashFetchedAtSlot,
      faultInjected: injectThisAttempt || false,
      sendError: sendErr ? String(sendErr) : undefined,
      submittedAt,
    });

    // Poll the chain for the landing; record each stage (with a true
    // deltaFromPrevMs) and stream it live to the dashboard.
    let landing: Landing = { landed: false };
    if (!sendErr) {
      landing = await pollLanding(
        connection,
        signature,
        (stage, slot, at) => {
          const prev = rec.stages[rec.stages.length - 1];
          rec.stages.push({ stage, observedAt: at, slot, deltaFromPrevMs: prev ? at - prev.observedAt : undefined });
          pub("stage", { signature, stage, slot, at });
          say(`  lifecycle: ${signature.slice(0, 12)}… → ${stage} @ slot ${slot}`);
        },
        { processedTimeoutMs: config.processedTimeoutMs, confirmTimeoutMs: 15_000, finalizeTimeoutMs: 20_000, intervalMs: config.pollIntervalMs }
      );
    }

    if (landing.landed) {
      entry.outcome = landing.outcome!;
      say(`bundle ${opts.index} attempt ${attempt}: LANDED (${landing.outcome} @ slot ${landing.slot})`);
      log.lifecycle(entry);
      return entry;
    }

    // ---- failure path: gather evidence, classify, ask the agent ----
    const evidence: FailureEvidence = {
      txErr: landing.txErr ?? (sendErr ? { sendError: String(sendErr) } : undefined),
      timedOut: !landing.landed && !landing.txErr && !sendErr,
    };
    try {
      evidence.blockhashStillValid = (
        await connection.isBlockhashValid(bh.blockhash, { commitment: "processed" })
      ).value;
    } catch { /* evidence stays partial */ }
    if (bundleId) {
      try {
        evidence.inflightStatus = (await jito.inflightStatuses([bundleId]))[0]?.status;
      } catch { /* ditto */ }
    }

    const { cls, detail } = classifyFailure(evidence);
    rec.failure = { class: cls, detail, detectedAt: Date.now(), detectedAtSlot: stream.currentSlot };
    say(`bundle ${opts.index} attempt ${attempt}: FAILED — ${cls} (${detail})`);
    pub("failure", {
      entryId: entry.id,
      index: opts.index,
      attempt,
      signature,
      class: cls,
      detail,
      detectedAtSlot: stream.currentSlot,
    });

    const snapshot = await tips.refresh();
    pub("tipfloor", { ...snapshot, congestion: tips.congestionFactor() });
    const ctx: AgentContext = {
      entryId: entry.id,
      attempt,
      maxAttempts: config.maxAttempts,
      failureClass: cls,
      failureDetail: detail,
      currentSlot: stream.currentSlot,
      slotsSinceBlockhashFetch: stream.currentSlot - blockhashFetchedAtSlot,
      lastTipLamports: tip.lamports,
      tipPercentiles: { p25: snapshot.p25, p50: snapshot.p50, p75: snapshot.p75, p95: snapshot.p95, p99: snapshot.p99 },
      maxTipLamports: config.maxTipLamports,
      congestionFactor: tips.congestionFactor(),
      attemptHistory: entry.attempts.map((a) => ({
        attempt: a.attempt,
        tipLamports: a.tip.lamports,
        outcome: a.failure ? "failed" : "landed",
        failureClass: a.failure?.class,
      })),
    };

    let decision: AgentDecision;
    try {
      decision = await agent.decide(ctx);
    } catch (err) {
      // The agent API is unavailable (e.g. no Anthropic credits, a 429, or a
      // network blip). Do NOT crash the bundle or fabricate a decision — a
      // judged campaign must never log invented reasoning. Record the failure
      // and abort this entry cleanly so it shows up honestly in the log.
      say(`agent error: ${String(err)} — aborting this bundle (no autonomous decision possible)`);
      log.event("agent-error", { entryId: entry.id, attempt, err: String(err) });
      entry.outcome = "aborted";
      log.lifecycle(entry);
      return entry;
    }
    log.agentDecision(decision);
    entry.agentDecisionIds.push(decision.id);
    pub("decision", { index: opts.index, ...decision });
    say(`agent [${agent.mode}]: ${decision.decision.action} (confidence ${decision.decision.confidence})`);
    say(`agent reasoning: ${decision.reasoning.slice(0, 300)}${decision.reasoning.length > 300 ? "…" : ""}`);

    if (decision.decision.action === "abort") {
      entry.outcome = "aborted";
      log.lifecycle(entry);
      return entry;
    }

    const changes = decision.decision.changes ?? {};
    // Enforce the budget guardrail even if the agent proposes past it.
    forcedTip = changes.newTipLamports !== undefined
      ? Math.min(changes.newTipLamports, config.maxTipLamports)
      : undefined;
    injectThisAttempt = false; // the fault fires once; recovery must be real
    const delaySlots = changes.delaySlots ?? 0;
    if (delaySlots > 0) {
      say(`agent requested delay of ${delaySlots} slots`);
      await new Promise((r) => setTimeout(r, delaySlots * 400));
    }
    // refreshBlockhash is implicit: every attempt re-fetches at loop top.
    attempt++;
  }

  entry.outcome = "failed";
  log.lifecycle(entry);
  return entry;
}

/**
 * Run one campaign end-to-end against an already-funded payer, publishing every
 * step to the attached dashboard. Caller owns the dashboard lifecycle and the
 * balance preflight; this starts the gRPC stream, runs the bundle loop, stops
 * the stream, and returns the landing tally. It never exits the process.
 */
export async function runCampaign(opts: {
  totalBundles: number;
  faultCount: number;
  payer: Keypair;
  connection: Connection;
}): Promise<{ landed: number; total: number }> {
  const { totalBundles, faultCount, payer, connection } = opts;

  pub("campaign", {
    totalBundles,
    faultCount,
    network: config.network,
    payer: payer.publicKey.toBase58(),
    maxTipLamports: config.maxTipLamports,
    maxAttempts: config.maxAttempts,
    blockEngine: config.blockEngineUrl,
    agentModel: config.agentModel,
    startedAt: Date.now(),
  });

  const stream = new GeyserStream();
  stream.on("connected", (e) => say(`geyser connected: ${JSON.stringify(e)}`));
  stream.on("disconnect", (e) => say(`geyser disconnect (${e.why}) — reconnecting`));
  stream.on("overflow", (e) => say(`geyser queue overflow: ${e.dropped} dropped`));

  const tips = new TipEngine();
  stream.on("slot", (u) => {
    tips.observeSlot(u.receivedAt);
    pub("slot", { slot: u.slot, status: u.status, receivedAt: u.receivedAt });
  });

  const jito = new JitoClient();
  const agent = new RetryAgent();
  const injector = new FaultInjector(connection);

  say(`agent mode: ${agent.mode}${agent.mode === "mock" ? " (set ANTHROPIC_API_KEY before the real campaign)" : ""}`);

  await stream.start();
  // Let the slot stream warm up so congestion estimates mean something.
  await new Promise((r) => setTimeout(r, 5000));

  // Fail fast on a dead Yellowstone endpoint. The gRPC slot stream drives the
  // live slot feed, congestion estimate, and leader-window timing; without it
  // the campaign is flying blind. A bad/missing GRPC token is the #1 setup
  // failure, so we surface it loudly instead of producing a garbage campaign.
  if (stream.currentSlot === 0) {
    throw new Error(
      "Yellowstone gRPC produced no slot updates in 5s — check GRPC_ENDPOINT/GRPC_X_TOKEN. " +
        "The default public endpoint often rejects token-less subscriptions; use a dedicated " +
        "provider (Helius / Triton / a PublicNode personal token)."
    );
  }
  say(`stream live at slot ${stream.currentSlot}`);
  const firstFloor = await tips.refresh();
  pub("tipfloor", { ...firstFloor, congestion: tips.congestionFactor() });

  const results: LifecycleEntry[] = [];
  for (let i = 1; i <= totalBundles; i++) {
    // Spread fault injections across the campaign (e.g. bundles 3 and 7).
    const injectFault = faultCount > 0 && i % Math.ceil(totalBundles / faultCount) === 3 % Math.ceil(totalBundles / faultCount) && results.filter((r) => r.attempts.some((a) => a.faultInjected)).length < faultCount;
    say(`\n=== bundle ${i}/${totalBundles}${injectFault ? " [fault injection]" : ""} ===`);
    try {
      const entry = await runOne({
        index: i,
        injectFault,
        deps: { connection, payer, stream, jito, tips, agent, injector },
      });
      results.push(entry);
      const lastLanded = [...entry.attempts].reverse().find((a) => !a.failure);
      pub("outcome", {
        entryId: entry.id,
        index: i,
        outcome: entry.outcome,
        attempts: entry.attempts.length,
        finalSignature: lastLanded?.signature,
        finalTipLamports: lastLanded?.tip.lamports,
      });
      say(`bundle ${i}: outcome=${entry.outcome} attempts=${entry.attempts.length}`);
    } catch (err) {
      say(`bundle ${i}: orchestrator error: ${String(err)}`);
      log.event("orchestrator-error", { bundle: i, err: String(err) });
    }
    // Respect the 1 req/s unauthenticated block-engine rate limit with headroom.
    await new Promise((r) => setTimeout(r, 3000));
  }

  const landed = results.filter((r) => r.outcome === "finalized" || r.outcome === "confirmed").length;
  pub("done", { landed, total: results.length, finishedAt: Date.now() });
  say(`\ncampaign done: ${landed}/${results.length} landed, logs in ${config.logDir}/`);
  await stream.stop(); // stop the metered gRPC stream; the dashboard keeps its buffer
  return { landed, total: results.length };
}

/** Terminal entrypoint: one campaign, then keep the dashboard alive for viewing. */
async function cliMain() {
  const { values: cli } = parseArgs({
    options: {
      bundles: { type: "string", default: "12" },
      "inject-faults": { type: "string", default: "2" },
    },
  });
  const totalBundles = parseInt(cli.bundles!, 10);
  const faultCount = parseInt(cli["inject-faults"]!, 10);

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(config.keypairPath, "utf8")))
  );
  say(`payer: ${payer.publicKey.toBase58()}`);

  const server = new DashboardServer();
  await server.start();
  useDashboard(server);
  say(`dashboard: ${server.url}  ← open this to watch the campaign live`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  say(`balance: ${balance / 1e9} SOL`);
  if (balance < config.minStartBalanceSol * 1e9) {
    throw new Error(`fund the payer with at least ${config.minStartBalanceSol} SOL`);
  }

  await runCampaign({ totalBundles, faultCount, payer, connection });

  // Don't exit: the HTTP server keeps the process alive so the finished
  // campaign stays viewable. All events are already buffered.
  say(`dashboard still live at ${server.url} — Ctrl-C to exit (logs are saved either way)`);
}

// Run a campaign directly only when this file is the entrypoint. When serve.ts
// imports runCampaign, this stays dormant (no campaign on import).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
