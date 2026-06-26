import type { FailureClass } from "../types.js";

/** Maps raw failure evidence onto a FailureClass, deterministically. */

export interface FailureEvidence {
  /** Error object from a stream tx update, if any. */
  txErr?: unknown;
  /** Jito inflight status, if known. */
  inflightStatus?: "Invalid" | "Pending" | "Failed" | "Landed";
  /** Result of an isBlockhashValid check at detection time. */
  blockhashStillValid?: boolean;
  /** Did we hit the processed-timeout without ever seeing the tx? */
  timedOut?: boolean;
}

export function classifyFailure(e: FailureEvidence): { cls: FailureClass; detail: string } {
  const errStr = e.txErr ? JSON.stringify(e.txErr) : "";

  // Expired/unknown blockhash, in all its shapes. Must run FIRST — the Jito send-path
  // string isn't BlockhashNotFound and otherwise falls through to bundle_failure.
  if (/BlockhashNotFound|expired\s+blockhash|blockhash[^"]*\bexpired|BlockheightExceeded|TransactionExpired/i.test(errStr)) {
    return { cls: "expired_blockhash", detail: `tx error: ${errStr}` };
  }
  if (/(ComputationalBudgetExceeded|ProgramFailedToComplete|exceeded.*compute|WouldExceedMaxBlockCostLimit)/i.test(errStr)) {
    return { cls: "compute_exceeded", detail: `tx error: ${errStr}` };
  }
  if (/(InsufficientFundsForFee|fee)/i.test(errStr)) {
    return { cls: "fee_too_low", detail: `tx error: ${errStr}` };
  }
  // Check the block engine's verdict before the blockhash heuristic; "Invalid" means
  // the bundle never entered the auction.
  if (e.inflightStatus === "Failed" || e.inflightStatus === "Invalid") {
    return {
      cls: "bundle_failure",
      detail: `block engine reported ${e.inflightStatus} — bundle dropped before/at auction` +
        (e.blockhashStillValid === false ? " (blockhash also expired by detection time)" : ""),
    };
  }
  if (e.timedOut && e.blockhashStillValid === false) {
    return {
      cls: "expired_blockhash",
      detail: "never observed at processed; blockhash no longer valid at detection",
    };
  }
  if (e.timedOut && e.inflightStatus === "Pending") {
    return {
      cls: "fee_too_low",
      detail: "bundle pending past timeout with valid blockhash — tip likely below inclusion floor",
    };
  }
  if (e.txErr) {
    return { cls: "bundle_failure", detail: `unmapped tx error: ${errStr}` };
  }
  return { cls: "unknown", detail: "no evidence matched a known failure class" };
}
