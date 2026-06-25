// Event contract — mirrors src/dashboard/server.ts publishes in the orchestrator.

export type StageName = "submitted" | "processed" | "confirmed" | "finalized";

export interface CampaignMeta {
  totalBundles: number;
  faultCount: number;
  network: string;
  payer: string;
  maxTipLamports: number;
  maxAttempts: number;
  blockEngine: string;
  agentModel: string;
  startedAt: number;
}

export interface SlotEv {
  slot: number;
  status: string; // "0"|"1"|"2" or SLOT_* names
  receivedAt: number;
}

export interface TipFloor {
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  ema50: number;
  congestion: number;
  time?: string;
  fetchedAt?: number;
}

export interface LeaderEv {
  currentSlot: number;
  nextLeaderSlot: number;
  identity: string;
  gap: number;
}

export interface AttemptEv {
  entryId: string;
  index: number;
  attempt: number;
  signature: string;
  bundleId?: string;
  tipLamports: number;
  tipAccount?: string;
  basisFormula?: string;
  percentiles?: { p50: number; p99: number };
  targetLeaderSlot?: number;
  targetLeaderIdentity?: string;
  blockhashFetchedAtSlot?: number;
  faultInjected?: boolean;
  sendError?: string;
  submittedAt: number;
}

export interface StageEv {
  signature: string;
  stage: StageName;
  slot?: number;
  at: number;
}

export interface FailureEv {
  entryId: string;
  index: number;
  attempt: number;
  signature: string;
  class: string;
  detail: string;
  detectedAtSlot?: number;
}

export interface DecisionEv {
  index: number;
  id: string;
  at: number;
  trigger: {
    entryId: string;
    attempt: number;
    failureClass: string;
    failureDetail: string;
    networkContext?: {
      currentSlot?: number;
      recentTipPercentiles?: Record<string, number>;
      slotsSinceBlockhashFetch?: number;
      attemptsSoFar?: number;
    };
  };
  reasoning: string;
  decision: {
    action: "retry" | "abort";
    changes?: {
      refreshBlockhash?: boolean;
      newTipLamports?: number;
      delaySlots?: number;
      otherAdjustments?: string;
    };
    confidence: number;
    rejectedAlternatives: string[];
  };
  model: string;
}

export interface OutcomeEv {
  entryId: string;
  index: number;
  outcome: string; // finalized | confirmed | processed | aborted | failed
  attempts: number;
  finalSignature?: string;
  finalTipLamports?: number;
}

export interface DoneEv {
  landed: number;
  total: number;
  finishedAt: number;
}

/** Run lifecycle from the control console (serve.ts). */
export interface RunStateEv {
  state: "idle" | "running" | "complete" | "error";
  bundles?: number;
  faults?: number;
  landed?: number;
  total?: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface Envelope {
  t: string;
  ts: number;
  d: unknown;
}

// ---- derived row for the orchestrations table ----

export type RowStatus =
  | "submitted"
  | "processing"
  | "processed"
  | "confirmed"
  | "finalized"
  | "dropped"
  | "aborted";

export interface OrchRow {
  signature: string;
  entryId: string;
  index: number;
  attempt: number;
  tipLamports: number;
  bundleId?: string;
  targetLeaderSlot?: number;
  faultInjected?: boolean;
  submittedAt: number;
  status: RowStatus;
  stageTimes: Partial<Record<StageName, number>>;
  stageSlots: Partial<Record<StageName, number>>;
  failureClass?: string;
  failureDetail?: string;
  landed: boolean;
}

export const SLOT_CONFIRMED = new Set(["SLOT_CONFIRMED", "1", "confirmed"]);
export const SLOT_FINALIZED = new Set(["SLOT_FINALIZED", "2", "finalized"]);

export function slotStatusLabel(status: string): "processed" | "confirmed" | "finalized" {
  if (SLOT_FINALIZED.has(status)) return "finalized";
  if (SLOT_CONFIRMED.has(status)) return "confirmed";
  return "processed";
}
