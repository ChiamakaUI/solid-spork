import { config } from "../config.js";
import type { TipDecision } from "../types.js";

/** Dynamic tip engine: prices tips from live Jito tip-floor data scaled by congestion. */

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
      // Reuse the last good snapshot on a transient fetch failure; only throw on the first fetch.
      if (this.snapshot) return this.snapshot;
      throw err;
    }
  }

  /** Congestion factor: ratio of median slot interval to the nominal 400ms. */
  congestionFactor(): number {
    if (this.slotIntervalsMs.length < 8) return 1;
    const sorted = [...this.slotIntervalsMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Math.min(2.5, Math.max(0.8, median / 400));
  }

  /** Price a bundle: ema50 of landed tips scaled by congestion, clamped to min/max. */
  async decide(tipAccount: string): Promise<TipDecision> {
    const snapAge = this.snapshot ? Date.now() - this.snapshot.fetchedAt : Infinity;
    if (snapAge > 30_000) await this.refresh();
    const s = this.snapshot!;
    const congestion = this.congestionFactor();
    const raw = s.ema50 * congestion;
    // Floor at Jito's minimum, cap at the budget guardrail maxTipLamports.
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
        formula: `clamp(ema50(${s.ema50}) × congestion(${congestion.toFixed(2)}), min=${config.jitoMinTipLamports}, max=${config.maxTipLamports})`,
      },
    };
  }
}
