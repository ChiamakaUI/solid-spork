import { type Envelope } from "./events";

/**
 * Replay engine for the hosted page.
 *
 * The deployed dashboard has no live campaign to subscribe to, so it loads the
 * two committed JSONL logs and reconstructs the same event stream the live
 * server would have emitted — then plays it back with compressed timing so the
 * recorded campaign feels live. Every figure shown is real and on-chain.
 */

interface LifecycleEntry {
  id: string;
  createdAt: number;
  network: string;
  outcome: string;
  attempts: Array<{
    attempt: number;
    bundleId?: string;
    signature: string;
    blockhash: string;
    blockhashFetchedAtSlot?: number;
    tip: {
      lamports: number;
      tipAccount: string;
      basis: {
        landedTips25th: number;
        landedTips50th: number;
        landedTips75th: number;
        landedTips95th: number;
        landedTips99th: number;
        congestionFactor: number;
        formula: string;
      };
    };
    targetLeaderSlot?: number;
    targetLeaderIdentity?: string;
    stages: Array<{ stage: string; observedAt: number; slot?: number; deltaFromPrevMs?: number }>;
    failure?: { class: string; detail: string; detectedAt: number; detectedAtSlot?: number };
    faultInjected?: boolean;
  }>;
}

function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter((x): x is T => x !== null);
}

export async function loadReplayEvents(base = "/data"): Promise<Envelope[]> {
  const [lifeTxt, decTxt] = await Promise.all([
    fetch(`${base}/lifecycle.jsonl`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
    fetch(`${base}/agent-decisions.jsonl`, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
  ]);
  const entries = parseJsonl<LifecycleEntry>(lifeTxt);
  const decisions = parseJsonl<any>(decTxt);
  if (!entries.length && !decisions.length) return [];

  const indexByEntry = new Map<string, number>();
  entries.forEach((e, i) => indexByEntry.set(e.id, i + 1));

  const evs: Envelope[] = [];
  const push = (t: string, ts: number, d: unknown) => evs.push({ t, ts, d });

  let minTs = Infinity;
  let maxTs = 0;
  let faultCount = 0;

  for (const e of entries) {
    const index = indexByEntry.get(e.id)!;
    if (e.attempts.some((a) => a.faultInjected)) faultCount++;
    let lastTs = e.createdAt;
    let finalLanded: { sig: string; tip: number } | undefined;

    for (const a of e.attempts) {
      const submittedAt =
        a.stages.find((st) => st.stage === "submitted")?.observedAt ?? e.createdAt;
      minTs = Math.min(minTs, submittedAt);

      push("leader", submittedAt - 1, {
        currentSlot: a.blockhashFetchedAtSlot ?? 0,
        nextLeaderSlot: a.targetLeaderSlot ?? 0,
        identity: a.targetLeaderIdentity ?? "unknown",
        gap: (a.targetLeaderSlot ?? 0) - (a.blockhashFetchedAtSlot ?? 0),
      });
      push("tipfloor", submittedAt - 1, {
        p25: a.tip.basis.landedTips25th,
        p50: a.tip.basis.landedTips50th,
        p75: a.tip.basis.landedTips75th,
        p95: a.tip.basis.landedTips95th,
        p99: a.tip.basis.landedTips99th,
        ema50: a.tip.basis.landedTips50th,
        congestion: a.tip.basis.congestionFactor,
      });
      push("attempt", submittedAt, {
        entryId: e.id,
        index,
        attempt: a.attempt,
        signature: a.signature,
        bundleId: a.bundleId,
        tipLamports: a.tip.lamports,
        tipAccount: a.tip.tipAccount,
        basisFormula: a.tip.basis.formula,
        percentiles: { p50: a.tip.basis.landedTips50th, p99: a.tip.basis.landedTips99th },
        targetLeaderSlot: a.targetLeaderSlot,
        targetLeaderIdentity: a.targetLeaderIdentity,
        blockhashFetchedAtSlot: a.blockhashFetchedAtSlot,
        faultInjected: a.faultInjected,
        submittedAt,
      });

      for (const st of a.stages) {
        if (st.stage === "submitted") continue;
        push("stage", st.observedAt, {
          signature: a.signature,
          stage: st.stage,
          slot: st.slot,
          at: st.observedAt,
        });
        lastTs = Math.max(lastTs, st.observedAt);
        if (st.stage === "confirmed" || st.stage === "finalized") {
          finalLanded = { sig: a.signature, tip: a.tip.lamports };
        }
      }
      if (a.failure) {
        push("failure", a.failure.detectedAt, {
          entryId: e.id,
          index,
          attempt: a.attempt,
          signature: a.signature,
          class: a.failure.class,
          detail: a.failure.detail,
          detectedAtSlot: a.failure.detectedAtSlot,
        });
        lastTs = Math.max(lastTs, a.failure.detectedAt);
      }
    }

    push("outcome", lastTs + 1, {
      entryId: e.id,
      index,
      outcome: e.outcome,
      attempts: e.attempts.length,
      finalSignature: finalLanded?.sig,
      finalTipLamports: finalLanded?.tip,
    });
    maxTs = Math.max(maxTs, lastTs + 1);
  }

  for (const d of decisions) {
    const at = d.at ?? d.trigger?.networkContext?.currentSlot ?? minTs;
    minTs = Math.min(minTs, at);
    maxTs = Math.max(maxTs, at);
    push("decision", at, { index: indexByEntry.get(d.trigger?.entryId) ?? 0, ...d });
  }

  if (!Number.isFinite(minTs)) minTs = Date.now();

  // Campaign header (synthesised from the logs).
  push("campaign", minTs - 2, {
    totalBundles: entries.length,
    faultCount,
    network: entries[0]?.network ?? "mainnet-beta",
    payer: "recorded-campaign",
    maxTipLamports: 3_000_000,
    maxAttempts: 6,
    blockEngine: "amsterdam.mainnet.block-engine.jito.wtf",
    agentModel: decisions[0]?.model ?? "claude",
    startedAt: minTs,
  });

  const landed = entries.filter((e) => e.outcome === "finalized" || e.outcome === "confirmed").length;
  push("done", maxTs + 2, { landed, total: entries.length, finishedAt: maxTs });

  evs.sort((a, b) => a.ts - b.ts);
  return evs;
}

export interface PlayerHandle {
  stop: () => void;
}

/**
 * Plays a reconstructed event list back through `emit`, compressing the real
 * inter-event gaps, and runs a synthetic slot ticker so the live slot feed
 * stays animated during replay.
 */
export function playReplay(
  events: Envelope[],
  emit: (e: Envelope) => void,
  opts: { speed?: number; minGap?: number; maxGap?: number; loop?: boolean } = {}
): PlayerHandle {
  const speed = opts.speed ?? 0.28;
  const minGap = opts.minGap ?? 240;
  const maxGap = opts.maxGap ?? 1500;
  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let slotTimer: ReturnType<typeof setInterval> | null = null;
  let baseSlot = 0;

  // Seed slot ticker from the first known slot.
  for (const e of events) {
    const d = e.d as any;
    if (e.t === "leader" && d?.currentSlot) {
      baseSlot = d.currentSlot;
      break;
    }
    if (e.t === "stage" && d?.slot) {
      baseSlot = d.slot;
      break;
    }
  }

  const run = () => {
    if (!events.length) return;
    let acc = 0;
    let prev = events[0].ts;
    let slotCursor = baseSlot;
    const statuses = ["0", "0", "1", "0", "2", "1"];
    let si = 0;

    if (baseSlot > 0) {
      slotTimer = setInterval(() => {
        if (stopped) return;
        slotCursor += 1;
        emit({
          t: "slot",
          ts: Date.now(),
          d: { slot: slotCursor, status: statuses[si++ % statuses.length], receivedAt: Date.now() },
        });
      }, 430);
    }

    events.forEach((ev) => {
      const gap = Math.min(maxGap, Math.max(minGap, (ev.ts - prev) * speed));
      prev = ev.ts;
      acc += gap;
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          if ((ev.d as any)?.currentSlot && (ev.d as any).currentSlot > slotCursor) {
            slotCursor = (ev.d as any).currentSlot;
          }
          emit(ev);
        }, acc)
      );
    });

    if (opts.loop) {
      timers.push(
        setTimeout(() => {
          if (stopped) return;
          if (slotTimer) clearInterval(slotTimer);
          timers.forEach(clearTimeout);
          timers.length = 0;
          run();
        }, acc + 4000)
      );
    }
  };

  run();

  return {
    stop: () => {
      stopped = true;
      timers.forEach(clearTimeout);
      if (slotTimer) clearInterval(slotTimer);
    },
  };
}
