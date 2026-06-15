import { Connection } from "@solana/web3.js";
import type { LeaderWindow } from "../types.js";

/**
 * Leader schedule tracking.
 *
 * Yellowstone does not expose the leader schedule, so we maintain a rolling
 * window via JSON-RPC `getSlotLeaders` (refreshed as the tip advances) and
 * combine it with Jito's `getNextScheduledLeader` (which tells us the next
 * slot whose leader runs the Jito-Solana client). Leaders rotate every
 * 4 slots; the schedule is fixed per epoch, so caching is safe.
 */
export class LeaderTracker {
  private leadersBySlot = new Map<number, string>();
  private windowStart = 0;

  constructor(private connection: Connection, private windowSize = 5000) {}

  async refresh(currentSlot: number) {
    // Re-fetch when we've consumed half the cached window.
    if (
      this.leadersBySlot.size &&
      currentSlot < this.windowStart + this.windowSize / 2
    ) {
      return;
    }
    const leaders = await this.connection.getSlotLeaders(currentSlot, this.windowSize);
    this.leadersBySlot.clear();
    this.windowStart = currentSlot;
    leaders.forEach((leader, i) => {
      this.leadersBySlot.set(currentSlot + i, leader.toBase58());
    });
  }

  leaderFor(slot: number): string | undefined {
    return this.leadersBySlot.get(slot);
  }

  /** The 4-slot leader window containing `slot`, if cached. */
  windowFor(slot: number): LeaderWindow | undefined {
    const leader = this.leadersBySlot.get(slot);
    if (!leader) return undefined;
    const startSlot = slot - (slot % 4);
    return { leader, startSlot, endSlot: startSlot + 3 };
  }
}
