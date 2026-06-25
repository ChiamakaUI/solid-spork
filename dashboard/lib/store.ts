import {
  type AttemptEv,
  type CampaignMeta,
  type DecisionEv,
  type DoneEv,
  type Envelope,
  type FailureEv,
  type LeaderEv,
  type OrchRow,
  type OutcomeEv,
  type RunStateEv,
  type SlotEv,
  type StageEv,
  type TipFloor,
} from "./events";

export interface Recovery {
  index: number;
  attempt: number;
  failureClass: string;
  action: string;
  nextTip?: number;
  confidence: number;
  reasoning: string;
  at: number;
}

export interface DashState {
  mode: "idle" | "connecting" | "live" | "replay";
  campaign?: CampaignMeta;
  currentSlot: number;
  slotFeed: { slot: number; status: string; at: number }[];
  slotTimes: number[];
  tipFloor?: TipFloor;
  congestion: number;
  leader?: LeaderEv;
  rows: OrchRow[];
  rowBySig: Map<string, OrchRow>;
  decisions: DecisionEv[];
  recovery?: Recovery;
  outcomes: Map<string, OutcomeEv>;
  confLatencies: number[];
  tipResults: { tip: number; landed: boolean }[];
  landed: number;
  total: number;
  done?: DoneEv;
  run?: RunStateEv;
  lastEventAt: number;
}

function initialState(): DashState {
  return {
    mode: "idle",
    currentSlot: 0,
    slotFeed: [],
    slotTimes: [],
    congestion: 1,
    rows: [],
    rowBySig: new Map(),
    decisions: [],
    outcomes: new Map(),
    confLatencies: [],
    tipResults: [],
    landed: 0,
    total: 0,
    lastEventAt: 0,
  };
}

const LANDED = new Set(["finalized", "confirmed"]);

export class DashboardStore {
  state: DashState = initialState();
  private listeners = new Set<() => void>();
  private version = 0;
  private scheduled = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.version;
  getServerSnapshot = () => 0;
  getState = () => this.state;

  setMode(m: DashState["mode"]) {
    this.state.mode = m;
    this.markDirty();
  }

  reset() {
    this.state = initialState();
    this.markDirty();
  }

  applyEvent(env: Envelope) {
    try {
      this.reduce(env);
    } catch {
      /* a malformed event must never break the stream */
    }
    this.state.lastEventAt = env.ts || Date.now();
    this.markDirty();
  }

  private markDirty() {
    if (this.scheduled) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      this.version++;
      this.listeners.forEach((l) => l());
    };
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(flush);
    else setTimeout(flush, 60);
  }

  private reduce(env: Envelope) {
    const s = this.state;
    switch (env.t) {
      case "campaign": {
        // A new campaign starts a fresh run timeline; network telemetry (slot
        // feed, tip floor, leader, congestion) persists across runs.
        s.rows = [];
        s.rowBySig = new Map();
        s.decisions = [];
        s.recovery = undefined;
        s.outcomes = new Map();
        s.confLatencies = [];
        s.tipResults = [];
        s.landed = 0;
        s.done = undefined;
        s.campaign = env.d as CampaignMeta;
        s.total = s.campaign.totalBundles ?? 0;
        break;
      }
      case "runstate": {
        s.run = env.d as RunStateEv;
        break;
      }
      case "slot": {
        const d = env.d as SlotEv;
        if (d.slot > s.currentSlot) s.currentSlot = d.slot;
        s.slotFeed.unshift({ slot: d.slot, status: String(d.status), at: d.receivedAt });
        if (s.slotFeed.length > 48) s.slotFeed.length = 48;
        s.slotTimes.push(d.receivedAt);
        if (s.slotTimes.length > 64) s.slotTimes.shift();
        break;
      }
      case "tipfloor": {
        const d = env.d as TipFloor;
        s.tipFloor = d;
        if (Number.isFinite(d.congestion)) s.congestion = d.congestion;
        break;
      }
      case "leader": {
        s.leader = env.d as LeaderEv;
        break;
      }
      case "attempt": {
        const d = env.d as AttemptEv;
        const row: OrchRow = {
          signature: d.signature,
          entryId: d.entryId,
          index: d.index,
          attempt: d.attempt,
          tipLamports: d.tipLamports,
          bundleId: d.bundleId,
          targetLeaderSlot: d.targetLeaderSlot,
          faultInjected: d.faultInjected,
          submittedAt: d.submittedAt,
          status: d.sendError ? "dropped" : "submitted",
          stageTimes: { submitted: d.submittedAt },
          stageSlots: {},
          failureDetail: d.sendError,
          landed: false,
        };
        s.rowBySig.set(d.signature, row);
        s.rows.unshift(row);
        if (s.rows.length > 80) {
          const removed = s.rows.pop();
          if (removed) s.rowBySig.delete(removed.signature);
        }
        break;
      }
      case "stage": {
        const d = env.d as StageEv;
        const row = s.rowBySig.get(d.signature);
        if (!row) break;
        row.stageTimes[d.stage] = d.at;
        if (d.slot != null) row.stageSlots[d.stage] = d.slot;
        if (d.stage === "finalized") {
          row.status = "finalized";
          row.landed = true;
        } else if (d.stage === "confirmed") {
          if (row.status !== "finalized") row.status = "confirmed";
          row.landed = true;
          const p = row.stageTimes.processed;
          if (p) s.confLatencies.push(Math.max(0, d.at - p));
          if (s.confLatencies.length > 60) s.confLatencies.shift();
        } else if (d.stage === "processed") {
          if (row.status === "submitted") row.status = "processed";
        }
        break;
      }
      case "failure": {
        const d = env.d as FailureEv;
        const row = s.rowBySig.get(d.signature);
        if (row) {
          row.status = "dropped";
          row.failureClass = d.class;
          row.failureDetail = d.detail;
          s.tipResults.push({ tip: row.tipLamports, landed: false });
          if (s.tipResults.length > 90) s.tipResults.shift();
        }
        s.recovery = {
          index: d.index,
          attempt: d.attempt,
          failureClass: d.class,
          action: "analyzing",
          confidence: 0,
          reasoning: "",
          at: env.ts,
        };
        break;
      }
      case "decision": {
        const d = env.d as DecisionEv;
        s.decisions.unshift(d);
        if (s.decisions.length > 40) s.decisions.length = 40;
        s.recovery = {
          index: d.index,
          attempt: d.trigger?.attempt ?? 0,
          failureClass: d.trigger?.failureClass ?? "—",
          action: d.decision.action,
          nextTip: d.decision.changes?.newTipLamports,
          confidence: d.decision.confidence,
          reasoning: d.reasoning,
          at: d.at,
        };
        break;
      }
      case "outcome": {
        const d = env.d as OutcomeEv;
        s.outcomes.set(d.entryId, d);
        if (d.finalSignature) {
          const row = s.rowBySig.get(d.finalSignature);
          if (row && LANDED.has(d.outcome)) {
            row.landed = true;
            if (row.status !== "finalized") row.status = d.outcome === "finalized" ? "finalized" : "confirmed";
          }
          if (LANDED.has(d.outcome)) {
            s.tipResults.push({ tip: d.finalTipLamports ?? 0, landed: true });
            if (s.tipResults.length > 90) s.tipResults.shift();
          }
        }
        // Mark aborted rows for this entry that never landed.
        if (d.outcome === "aborted") {
          for (const row of s.rows) {
            if (row.entryId === d.entryId && !row.landed && row.status !== "dropped") {
              row.status = "aborted";
            }
          }
        }
        s.landed = [...s.outcomes.values()].filter((o) => LANDED.has(o.outcome)).length;
        break;
      }
      case "done": {
        s.done = env.d as DoneEv;
        s.landed = s.done.landed;
        s.total = s.done.total;
        break;
      }
    }
  }
}

/** Rough TPS from recent slot arrival timing. */
export function tps(slotTimes: number[]): number {
  if (slotTimes.length < 4) return 0;
  const first = slotTimes[0];
  const last = slotTimes[slotTimes.length - 1];
  const span = (last - first) / 1000;
  if (span <= 0) return 0;
  // ~ slots/sec × an assumed ~1600 tx/slot heuristic for display flavor.
  const slotsPerSec = (slotTimes.length - 1) / span;
  return Math.round(slotsPerSec * 1100);
}

/** Slot jitter (ms): spread of recent inter-slot intervals vs nominal 400ms. */
export function slotJitter(slotTimes: number[]): number {
  if (slotTimes.length < 6) return 0;
  const iv: number[] = [];
  for (let i = 1; i < slotTimes.length; i++) iv.push(slotTimes[i] - slotTimes[i - 1]);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  const variance = iv.reduce((a, b) => a + (b - mean) ** 2, 0) / iv.length;
  return Math.round(Math.sqrt(variance));
}

/**
 * Landing-probability estimate (display heuristic, clearly labelled as such in
 * the UI). Combines the latest tip vs the live floor, congestion, and how close
 * the next Jito leader is. Not a guarantee — a transparent score.
 */
export function landingProbability(s: DashState): number {
  const floor = s.tipFloor;
  const latest = s.rows[0];
  if (!floor || !latest) return 0.5;
  const ref = Math.max(floor.p99, floor.ema50 * 1.5, 1);
  const tipRatio = Math.min(1.4, latest.tipLamports / ref); // 1.0 ≈ at floor
  let p = 0.28 + 0.5 * Math.min(1, tipRatio); // tip contribution
  p -= Math.max(0, (s.congestion - 1) * 0.18); // congestion drag
  const gap = s.leader?.gap ?? 4;
  p -= Math.min(0.12, Math.max(0, gap - 4) * 0.01); // far leader window
  if (latest.landed) p = Math.max(p, 0.9);
  if (latest.status === "dropped") p = Math.min(p, 0.4);
  return Math.max(0.04, Math.min(0.985, p));
}
