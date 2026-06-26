import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher.js";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types.js";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { config } from "../config.js";

/** Optional gRPC searcher auth keypair, loaded once. */
function loadAuthKeypair(): Keypair | undefined {
  if (!config.jitoAuthKeypairPath) return undefined;
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(config.jitoAuthKeypairPath, "utf8")))
  );
}

/** Normalize jito-ts wrapped ({ ok, value | error }) and bare returns. */
function unwrap<T>(res: unknown): T {
  if (res && typeof res === "object" && "ok" in (res as any)) {
    const r = res as { ok: boolean; value: T; error?: unknown };
    if (r.ok) return r.value;
    throw new Error(`jito-ts error: ${String((r as any).error)}`);
  }
  return res as T;
}

export interface NextLeaderInfo {
  currentSlot: number;
  nextLeaderSlot: number;
  nextLeaderIdentity: string;
}

export interface InflightStatus {
  bundleId: string;
  status: "Invalid" | "Pending" | "Failed" | "Landed";
  landedSlot: number | null;
}

export class JitoClient {
  private client = searcherClient(config.blockEngineUrl, loadAuthKeypair());
  private tipAccounts: string[] = [];
  private lastRequestAt = 0;

  /** Headers for HTTP block-engine calls; adds x-jito-auth when a key is set. */
  private httpHeaders(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.jitoAuthKey) h["x-jito-auth"] = config.jitoAuthKey;
    return h;
  }

  /** Gate every block-engine call to Jito's 1 req/s/IP limit (1.5s margin). */
  private async throttle(): Promise<void> {
    if (this.lastRequestAt === 0) this.lastRequestAt = Date.now();
    const wait = this.lastRequestAt + 1_500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private isRateLimit(e: unknown): boolean {
    const m = e instanceof Error ? e.message : String(e);
    return /rate limit|exhausted|back-off/i.test(m);
  }

  /** Throttled gRPC call with rate-limit back-off and retry. */
  private async grpc<T>(fn: () => Promise<unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      try {
        return unwrap<T>(await fn());
      } catch (e) {
        if (this.isRateLimit(e) && attempt < 5) {
          await new Promise((r) => setTimeout(r, 1_600 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  }

  async getTipAccounts(): Promise<string[]> {
    if (!this.tipAccounts.length) {
      this.tipAccounts = await this.grpc<string[]>(() => this.client.getTipAccounts());
    }
    return this.tipAccounts;
  }

  async randomTipAccount(): Promise<string> {
    const accounts = await this.getTipAccounts();
    return accounts[Math.floor(Math.random() * accounts.length)];
  }

  /** Next slot whose leader is connected to the Jito block engine. */
  async nextScheduledLeader(): Promise<NextLeaderInfo> {
    const r = await this.grpc<any>(() => this.client.getNextScheduledLeader());
    return {
      currentSlot: Number(r.currentSlot),
      nextLeaderSlot: Number(r.nextLeaderSlot),
      nextLeaderIdentity: r.nextLeaderIdentity,
    };
  }

  /** Build a bundle with a memo payload tx plus tip, on one blockhash. */
  buildBundle(opts: {
    payer: Keypair;
    blockhash: string;
    tipLamports: number;
    tipAccount: string;
    memoTag: string;
  }): { bundle: Bundle; signature: string } {
    const { payer, blockhash, tipLamports, tipAccount, memoTag } = opts;

    // Memo payload: on-chain-traceable, gives the tx substance beyond the tip.
    const memoIx = new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [],
      data: Buffer.from(`smart-tx-stack ${memoTag}`, "utf8"),
    });
    const tipIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(tipAccount),
      lamports: tipLamports,
    });

    // Tip rides in the same tx as the payload.
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [memoIx, tipIx],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);

    const bundle = new Bundle([tx], 5);
    const signature = bs58.encode(tx.signatures[0]);
    return { bundle, signature };
  }

  async sendBundle(bundle: Bundle): Promise<string> {
    return this.grpc<string>(() => this.client.sendBundle(bundle));
  }

  /** HTTP JSON-RPC: status of bundles seen in the last ~5 minutes. */
  async inflightStatuses(bundleIds: string[]): Promise<InflightStatus[]> {
    await this.throttle();
    const res = await fetch(config.blockEngineHttp, {
      method: "POST",
      headers: this.httpHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getInflightBundleStatuses",
        params: [bundleIds],
      }),
    });
    if (!res.ok) throw new Error(`getInflightBundleStatuses HTTP ${res.status}`);
    const body = (await res.json()) as any;
    if (body.error) throw new Error(`getInflightBundleStatuses: ${JSON.stringify(body.error)}`);
    return (body.result?.value ?? []).map((v: any) => ({
      bundleId: v.bundle_id,
      status: v.status,
      landedSlot: v.landed_slot ?? null,
    }));
  }
}
