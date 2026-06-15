import { EventEmitter } from "node:events";
import type { GeyserStream, TxStatusEvent } from "../stream/geyser.js";
import type { CommitmentStage, SlotUpdate, StageRecord } from "../types.js";

/**
 * Stream-driven lifecycle tracking — no RPC polling in the primary path.
 *
 * Yellowstone emits a transaction-status update once, when the tx reaches
 * `processed`. Confirmed/finalized are then derived by promotion: we watch
 * every slot-status transition, and when slot S reaches confirmed or
 * finalized, every watched signature that landed in S is promoted with it.
 * Slot updates for a tx's slot always arrive after the tx update itself,
 * so promotion never races.
 *
 * Dead-slot handling: if a slot we have txs in is marked dead (fork
 * abandoned), those txs are reported failed so the retry path can engage.
 */

interface Watched {
  signature: string;
  stages: StageRecord[];
  landedSlot?: number;
  err?: unknown;
}

const SLOT_STATUS_CONFIRMED = new Set(["SLOT_CONFIRMED", "1", "confirmed"]);
const SLOT_STATUS_FINALIZED = new Set(["SLOT_FINALIZED", "2", "finalized"]);
const SLOT_STATUS_DEAD = new Set(["SLOT_DEAD", "6", "dead"]);

export class LifecycleTracker extends EventEmitter {
  private watched = new Map<string, Watched>();
  /** slot → signatures that landed there, awaiting promotion. */
  private bySlot = new Map<number, Set<string>>();

  constructor(private stream: GeyserStream) {
    super();
    stream.on("tx", (evt: TxStatusEvent) => this.onTx(evt));
    stream.on("slot", (u: SlotUpdate) => this.onSlot(u));
  }

  track(signature: string, submittedAt: number) {
    const w: Watched = {
      signature,
      stages: [{ stage: "submitted", observedAt: submittedAt }],
    };
    this.watched.set(signature, w);
    this.stream.watch(signature);
  }

  stagesOf(signature: string): StageRecord[] {
    return this.watched.get(signature)?.stages ?? [];
  }

  release(signature: string) {
    const w = this.watched.get(signature);
    if (w?.landedSlot) this.bySlot.get(w.landedSlot)?.delete(signature);
    this.watched.delete(signature);
    this.stream.unwatch(signature);
  }

  private record(w: Watched, stage: CommitmentStage, slot: number | undefined, at: number) {
    const prev = w.stages[w.stages.length - 1];
    w.stages.push({
      stage,
      observedAt: at,
      slot,
      deltaFromPrevMs: prev ? at - prev.observedAt : undefined,
    });
    this.emit("stage", { signature: w.signature, stage, slot, at });
  }

  private onTx(evt: TxStatusEvent) {
    const w = this.watched.get(evt.signature);
    if (!w) return;
    if (evt.err) {
      w.err = evt.err;
      this.emit("tx-error", { signature: evt.signature, err: evt.err, slot: evt.slot });
      return;
    }
    if (w.stages.some((s) => s.stage === "processed")) return;
    w.landedSlot = evt.slot;
    if (!this.bySlot.has(evt.slot)) this.bySlot.set(evt.slot, new Set());
    this.bySlot.get(evt.slot)!.add(evt.signature);
    this.record(w, "processed", evt.slot, evt.receivedAt);
  }

  private onSlot(u: SlotUpdate) {
    const sigs = this.bySlot.get(u.slot);
    if (!sigs?.size) return;

    if (SLOT_STATUS_DEAD.has(u.status)) {
      for (const sig of [...sigs]) {
        const w = this.watched.get(sig);
        if (!w) continue;
        this.emit("tx-dead-slot", { signature: sig, slot: u.slot });
      }
      this.bySlot.delete(u.slot);
      return;
    }

    const stage: CommitmentStage | null = SLOT_STATUS_CONFIRMED.has(u.status)
      ? "confirmed"
      : SLOT_STATUS_FINALIZED.has(u.status)
        ? "finalized"
        : null;
    if (!stage) return;

    for (const sig of sigs) {
      const w = this.watched.get(sig);
      if (!w || w.stages.some((s) => s.stage === stage)) continue;
      this.record(w, stage, u.slot, u.receivedAt);
      if (stage === "finalized") this.emit("finalized", { signature: sig, slot: u.slot });
    }
    if (stage === "finalized") this.bySlot.delete(u.slot);
  }
}
