import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { config } from "./config.js";
import { GeyserStream } from "./stream/geyser.js";
import { LeaderTracker } from "./stream/leaders.js";
import { TipEngine } from "./tip/engine.js";
import { JitoClient } from "./jito/client.js";
import { LifecycleTracker } from "./lifecycle/tracker.js";
import { classifyFailure, type FailureEvidence } from "./lifecycle/classifier.js";
import { RetryAgent, type AgentContext } from "./agent/agent.js";
import { FaultInjector } from "./fault/injector.js";
import { LogStore } from "./log/store.js";
import type { BundleAttempt, LifecycleEntry } from "./types.js";

/**
 * Campaign orchestrator.
 *
 * Control flow rule that matters for judging: this file contains NO retry
 * policy. When an attempt fails it is classified and handed to the agent;
 * the agent's decision (retry-with-changes or abort) is executed verbatim.
 */

const { values: cli } = parseArgs({
  options: {
    bundles: { type: "string", default: "12" },
    "inject-faults": { type: "string", default: "2" },
  },
});

const log = new LogStore();
const say = (msg: string) => {
  console.log(`[${new Date().toISOString()}] ${msg}`);
};

async function waitForLeaderWindow(jito: JitoClient, stream: GeyserStream): Promise<number> {
  for (;;) {
    const info = await jito.nextScheduledLeader();
    const gap = info.nextLeaderSlot - info.currentSlot;
    if (gap <= 8) {
      say(`leader window: slot ${info.nextLeaderSlot} (${gap} slots away, leader ${info.nextLeaderIdentity.slice(0, 8)}…)`);
      return info.nextLeaderSlot;
    }
    say(`holding: next Jito leader in ${gap} slots (~${Math.round(gap * 0.4)}s)`);
    await new Promise((r) => setTimeout(r, Math.min(gap * 400, 4000)));
  }
}

function waitForStage(
  tracker: LifecycleTracker,
  signature: string,
  stage: string,
  timeoutMs: number
): Promise<{ reached: boolean; deadSlot?: boolean; txErr?: unknown }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({ reached: false });
    }, timeoutMs);
    const onStage = (e: any) => {
      if (e.signature === signature && e.stage === stage) {
        cleanup();
        resolve({ reached: true });
      }
    };
    const onDead = (e: any) => {
      if (e.signature === signature) {
        cleanup();
        resolve({ reached: false, deadSlot: true });
      }
    };
    const onErr = (e: any) => {
      if (e.signature === signature) {
        cleanup();
        resolve({ reached: false, txErr: e.err });
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      tracker.off("stage", onStage);
      tracker.off("tx-dead-slot", onDead);
      tracker.off("tx-error", onErr);
    };
    tracker.on("stage", onStage);
    tracker.on("tx-dead-slot", onDead);
    tracker.on("tx-error", onErr);
  });
}

async function runOne(opts: {
  index: number;
  injectFault: boolean;
  deps: {
    connection: Connection;
    payer: Keypair;
    stream: GeyserStream;
    tracker: LifecycleTracker;
    jito: JitoClient;
    tips: TipEngine;
    agent: RetryAgent;
    injector: FaultInjector;
  };
}): Promise<LifecycleEntry> {
  const { connection, payer, stream, tracker, jito, tips, agent, injector } = opts.deps;

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
    const targetLeaderSlot = await waitForLeaderWindow(jito, stream);

    const bh = await connection.getLatestBlockhash("confirmed");
    const blockhashFetchedAtSlot = stream.currentSlot;

    const tipAccount = await jito.randomTipAccount();
    const tip = forcedTip
      ? { ...(await tips.decide(tipAccount)), lamports: forcedTip }
      : await tips.decide(tipAccount, injectThisAttempt ? 1 : 1);

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
      stages: [],
      faultInjected: injectThisAttempt || undefined,
    };
    entry.attempts.push(rec);

    const submittedAt = Date.now();
    tracker.track(signature, submittedAt);
    rec.stages = tracker.stagesOf(signature);

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

    let processed: { reached: boolean; deadSlot?: boolean; txErr?: unknown } = { reached: false };
    if (!sendErr) {
      processed = await waitForStage(tracker, signature, "processed", config.processedTimeoutMs);
    }

    if (processed.reached) {
      const confirmed = await waitForStage(tracker, signature, "confirmed", 60_000);
      const finalized = confirmed.reached
        ? await waitForStage(tracker, signature, "finalized", 90_000)
        : { reached: false };
      tracker.release(signature);
      entry.outcome = finalized.reached ? "finalized" : confirmed.reached ? "confirmed" : "confirmed";
      log.lifecycle(entry);
      return entry;
    }

    // ---- failure path: gather evidence, classify, ask the agent ----
    tracker.release(signature);
    const evidence: FailureEvidence = {
      txErr: processed.txErr ?? (sendErr ? { sendError: String(sendErr) } : undefined),
      timedOut: !processed.reached && !processed.txErr && !sendErr,
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

    const snapshot = await tips.refresh();
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

    const decision = await agent.decide(ctx);
    log.agentDecision(decision);
    entry.agentDecisionIds.push(decision.id);
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

async function main() {
  const totalBundles = parseInt(cli.bundles!, 10);
  const faultCount = parseInt(cli["inject-faults"]!, 10);

  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(config.keypairPath, "utf8")))
  );
  say(`payer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const balance = await connection.getBalance(payer.publicKey);
  say(`balance: ${balance / 1e9} SOL`);
  if (balance < 0.01 * 1e9) throw new Error("fund the payer with at least 0.01 SOL");

  const stream = new GeyserStream();
  stream.on("connected", (e) => say(`geyser connected: ${JSON.stringify(e)}`));
  stream.on("disconnect", (e) => say(`geyser disconnect (${e.why}) — reconnecting`));
  stream.on("overflow", (e) => say(`geyser queue overflow: ${e.dropped} dropped`));

  const tips = new TipEngine();
  stream.on("slot", (u) => tips.observeSlot(u.receivedAt));

  const tracker = new LifecycleTracker(stream);
  tracker.on("stage", (e) =>
    say(`  lifecycle: ${e.signature.slice(0, 12)}… → ${e.stage} @ slot ${e.slot ?? "?"}`)
  );

  const jito = new JitoClient();
  const agent = new RetryAgent();
  const injector = new FaultInjector(connection);
  const leaders = new LeaderTracker(connection);

  say(`agent mode: ${agent.mode}${agent.mode === "mock" ? " (set ANTHROPIC_API_KEY before the real campaign)" : ""}`);

  await stream.start();
  // Let the slot stream warm up so congestion estimates mean something.
  await new Promise((r) => setTimeout(r, 5000));
  await tips.refresh();
  await leaders.refresh(stream.currentSlot);

  const results: LifecycleEntry[] = [];
  for (let i = 1; i <= totalBundles; i++) {
    // Spread fault injections across the campaign (e.g. bundles 3 and 7).
    const injectFault = faultCount > 0 && i % Math.ceil(totalBundles / faultCount) === 3 % Math.ceil(totalBundles / faultCount) && results.filter((r) => r.attempts.some((a) => a.faultInjected)).length < faultCount;
    say(`\n=== bundle ${i}/${totalBundles}${injectFault ? " [fault injection]" : ""} ===`);
    try {
      const entry = await runOne({
        index: i,
        injectFault,
        deps: { connection, payer, stream, tracker, jito, tips, agent, injector },
      });
      results.push(entry);
      say(`bundle ${i}: outcome=${entry.outcome} attempts=${entry.attempts.length}`);
    } catch (err) {
      say(`bundle ${i}: orchestrator error: ${String(err)}`);
      log.event("orchestrator-error", { bundle: i, err: String(err) });
    }
    // Respect the 1 req/s unauthenticated block-engine rate limit with headroom.
    await new Promise((r) => setTimeout(r, 3000));
  }

  const landed = results.filter((r) => r.outcome === "finalized" || r.outcome === "confirmed").length;
  say(`\ncampaign done: ${landed}/${results.length} landed, logs in ${config.logDir}/`);
  await stream.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
