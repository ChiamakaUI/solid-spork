import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { config } from "./config.js";

/** Load the payer keypair from KEYPAIR_JSON (inline byte array) or the keypair file. */
export function loadPayerKeypair(): Keypair {
  const raw = config.keypairJson ?? readFileSync(config.keypairPath, "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}
