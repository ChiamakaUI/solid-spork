import { Connection } from "@solana/web3.js";

/**
 * Fault injection (bounty requirement: simulate at least one blockhash
 * expiry). The injection is honest — we fetch a real blockhash and then
 * HOLD the signed transaction until the chain itself expires it
 * (lastValidBlockHeight passes). Nothing is faked: the resulting failure
 * is a genuine expired-blockhash rejection that the agent must recover
 * from autonomously.
 */
export class FaultInjector {
  constructor(private connection: Connection) {}

  /**
   * Block until `blockhash` is no longer valid. Checks every 5s; a
   * blockhash lives ~150 slots (~60s), so this typically resolves in
   * 60–90 seconds.
   */
  async holdUntilExpired(blockhash: string, onTick?: (validFor: boolean) => void): Promise<void> {
    for (;;) {
      const { value } = await this.connection.isBlockhashValid(blockhash, {
        commitment: "processed",
      });
      onTick?.(value);
      if (!value) return;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
