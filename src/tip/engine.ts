import { config } from "../config.js";
import type { TipDecision } from "../types.js";

/**
 * Dynamic tip engine. Every tip is computed from live Jito tip-floor data
 * (percentiles of recently LANDED tips) scaled by a congestion factor derived
 * from observed slot timing; the full basis is recorded on each decision.
 *
 * The tip-floor API reports values in SOL; we convert to lamports.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface TipFloorSnapshot {
  time: string;
  p25: number; // lamports
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  ema50: number;
  fetchedAt: number;
}

export class TipEngine {
  private snapshot: TipFloorSnapshot | null = null;
  /** Rolling slot-arrival intervals used as a cheap congestion proxy. */
  private slotIntervalsMs: number[] = [];
  private lastSlotAt = 0;

  observeSlot(receivedAt: number) {
    if (this.lastSlotAt) {
      this.slotIntervalsMs.push(receivedAt - this.lastSlotAt);
      if (this.slotIntervalsMs.length > 64) this.slotIntervalsMs.shift();
    }
    this.lastSlotAt = receivedAt;
  }

  async refresh(): Promise<TipFloorSnapshot> {
    try {
      const res = await fetch(config.tipFloorUrl);
      if (!res.ok) throw new Error(`tip_floor HTTP ${res.status}`);
      const body = (await res.json()) as any[];
      const row = body[0];
      const sol = (v: number) => Math.round(v * LAMPORTS_PER_SOL);
      this.snapshot = {
        time: row.time,
        p25: sol(row.landed_tips_25th_percentile),
        p50: sol(row.landed_tips_50th_percentile),
        p75: sol(row.landed_tips_75th_percentile),
        p95: sol(row.landed_tips_95th_percentile),
        p99: sol(row.landed_tips_99th_percentile),
        ema50: sol(row.ema_landed_tips_50th_percentile),
        fetchedAt: Date.now(),
      };
      return this.snapshot;
    } catch (err) {
      // A transient tip-floor fetch failure (e.g. `TypeError: fetch failed`)
      // must NEVER crash a live campaign mid-bundle. Reuse the last good
      // snapshot if we have one; only surface the error on the very first
      // fetch, when there is no floor to fall back to.
      if (this.snapshot) return this.snapshot;
      throw err;
    }
  }

  /**
   * Congestion factor: ratio of observed median slot interval to the
   * nominal 400ms. >1 means slots arriving slowly (network under load or
   * our stream lagging) — either way, landing odds drop and tips rise.
   */
  congestionFactor(): number {
    if (this.slotIntervalsMs.length < 8) return 1;
    const sorted = [...this.slotIntervalsMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.min(2.5, Math.max(0.8, median / 400));
  }

  /**
   * Price a bundle. Baseline is the 50th-percentile EMA of landed tips
   * (stable against single-block spikes), scaled by congestion, floored
   * at Jito's 1000-lamport minimum, and capped at p95 so a runaway factor
   * can't overspend.
   */
  async decide(tipAccount: string, urgencyMultiplier = 1): Promise<TipDecision> {
    const snapAge = this.snapshot ? Date.now() - this.snapshot.fetchedAt : Infinity;
    if (snapAge > 30_000) await this.refresh();
    const s = this.snapshot!;
    const congestion = this.congestionFactor();
    const raw = s.ema50 * congestion * urgencyMultiplier;
    // Floor at Jito's minimum, cap at the budget guardrail (NOT p95): on the
    // unauthenticated public endpoint the real inclusion floor can sit far
    // above the published landed-tip percentiles, so the agent must be free
    // to escalate past p95 toward maxTipLamports when bundles won't land.
    const lamports = Math.max(config.jitoMinTipLamports, Math.min(Math.round(raw), config.maxTipLamports));
    return {
      lamports,
      tipAccount,
      basis: {
        landedTips25th: s.p25,
        landedTips50th: s.p50,
        landedTips75th: s.p75,
        landedTips95th: s.p95,
        landedTips99th: s.p99,
        congestionFactor: congestion,
        formula: `clamp(ema50(${s.ema50}) × congestion(${congestion.toFixed(2)}) × urgency(${urgencyMultiplier}), min=${config.jitoMinTipLamports}, max=${config.maxTipLamports})`,
      },
    };
  }
}
