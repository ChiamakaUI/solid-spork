import { Connection } from "@solana/web3.js";

/**
 * Blockhash-expiry fault injection. Nothing is faked: we fetch a real
 * blockhash, HOLD the signed transaction until the chain expires it, then
 * submit anyway — producing a genuine expired-blockhash rejection for the
 * agent to recover from.
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
