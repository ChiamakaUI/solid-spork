/** Shared domain types for the smart transaction stack. */

export type CommitmentStage = "submitted" | "processed" | "confirmed" | "finalized";

export type FailureClass =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_failure"
  | "unknown";

export interface StageRecord {
  stage: CommitmentStage;
  /** Wall-clock time the stage was observed (ms since epoch). */
  observedAt: number;
  /** Slot at which the stage was reached, when known. */
  slot?: number;
  /** Milliseconds since the previous stage was observed. */
  deltaFromPrevMs?: number;
}

export interface TipDecision {
  lamports: number;
  /** Tip account the lamports were sent to. */
  tipAccount: string;
  /** The inputs that produced this tip — nothing is hardcoded. */
  basis: {
    landedTips25th: number;
    landedTips50th: number;
    landedTips75th: number;
    landedTips95th: number;
    landedTips99th: number;
    /** Extra signal, e.g. recent slot skip rate or queue depth. */
    congestionFactor: number;
    formula: string;
  };
}

export interface BundleAttempt {
  attempt: number;
  bundleId?: string;
  signature: string;
  blockhash: string;
  /** Slot height at which the blockhash was fetched (for expiry math). */
  blockhashFetchedAtSlot: number;
  tip: TipDecision;
  /** Leader window targeted for this submission. */
  targetLeaderSlot?: number;
  /** Identity (base58) of the Jito leader whose window we targeted. */
  targetLeaderIdentity?: string;
  /** Slot the bundle landed in (post-landing leader verification). */
  landedSlot?: number;
  /** Identity (base58) that actually produced `landedSlot`. */
  landedSlotLeader?: string;
  /** True iff `landedSlotLeader === targetLeaderIdentity`. */
  targetLeaderMatched?: boolean;
  stages: StageRecord[];
  failure?: {
    class: FailureClass;
    detail: string;
    detectedAt: number;
    detectedAtSlot?: number;
  };
  /** Set when this attempt's failure was injected deliberately. */
  faultInjected?: boolean;
}

/** One logical transaction's journey, across all retry attempts. */
export interface LifecycleEntry {
  id: string;
  createdAt: number;
  network: "mainnet-beta" | "testnet";
  attempts: BundleAttempt[];
  /** Final outcome after retries. */
  outcome: "finalized" | "confirmed" | "processed" | "failed" | "aborted";
  /** Agent decisions that shaped this entry (by decision id). */
  agentDecisionIds: string[];
}

/** A single decision made by the AI agent. */
export interface AgentDecision {
  id: string;
  at: number;
  trigger: {
    entryId: string;
    attempt: number;
    failureClass: FailureClass;
    failureDetail: string;
    networkContext: {
      currentSlot: number;
      recentTipPercentiles: { p25: number; p50: number; p75: number; p95?: number; p99?: number };
      slotsSinceBlockhashFetch: number;
      attemptsSoFar: number;
    };
  };
  /** The model's full reasoning, verbatim. */
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

export interface SlotUpdate {
  slot: number;
  /** processed | confirmed | finalized as reported by the stream. */
  status: string;
  receivedAt: number;
}
