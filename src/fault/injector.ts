import { Connection } from "@solana/web3.js";

/** Blockhash-expiry fault injection: holds a tx until the chain expires its blockhash. */
export class FaultInjector {
  constructor(private connection: Connection) {}

  /** Block until `blockhash` is no longer valid, polling every 5s. */
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
