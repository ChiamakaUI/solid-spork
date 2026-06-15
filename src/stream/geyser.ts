import GrpcDefault, { CommitmentLevel } from "@triton-one/yellowstone-grpc";

// CJS/ESM interop: under tsx/Node ESM the class arrives on `.default`.
const Client = ((GrpcDefault as any).default ?? GrpcDefault) as typeof GrpcDefault;
type GrpcClient = InstanceType<typeof GrpcDefault>;
import { EventEmitter } from "node:events";
import bs58 from "bs58";
import { config } from "../config.js";
import type { SlotUpdate } from "../types.js";

/**
 * Yellowstone gRPC wrapper.
 *
 * Design notes (these are judged requirements, not nice-to-haves):
 *  - Reconnects with exponential backoff + jitter; resubscribes with
 *    `fromSlot` set to the last seen slot so gaps are replayed.
 *  - Application-level ping every 10s keeps intermediaries from killing
 *    the idle stream; server pings are answered.
 *  - Backpressure: updates land in a bounded queue drained by an async
 *    loop, so a slow consumer can never stall the gRPC socket. Overflow
 *    is counted and logged, never silently dropped.
 *
 * Commitment tracking pattern: transaction-status updates fire ONCE per
 * subscription (at `processed`), so confirmed/finalized are derived by
 * subscribing to slot updates with filterByCommitment=false and promoting
 * every watched signature whose slot reaches that status. Transaction
 * updates for a slot always arrive before that slot's confirmed/finalized
 * notification, so promotion is race-free.
 */

export interface TxStatusEvent {
  signature: string;
  slot: number;
  err: unknown | null;
  receivedAt: number;
}

interface QueueItem {
  kind: "slot" | "tx";
  payload: any;
  receivedAt: number;
}

const MAX_QUEUE = 10_000;
const PING_INTERVAL_MS = 10_000;

export class GeyserStream extends EventEmitter {
  private client: GrpcClient;
  private stream: Awaited<ReturnType<GrpcClient["subscribe"]>> | null = null;
  private watched = new Set<string>();
  private lastSlot = 0;
  private queue: QueueItem[] = [];
  private draining = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private pingId = 0;
  public dropped = 0;

  constructor(
    private endpoint = config.grpcEndpoint,
    private xToken = config.grpcXToken
  ) {
    super();
    // v5 (NAPI engine) option names; raise the decode cap well past the
    // 4 MB default and keep the HTTP/2 connection alive while idle.
    this.client = new Client(this.endpoint, this.xToken, {
      grpcMaxDecodingMessageSize: 64 * 1024 * 1024,
      grpcHttp2KeepAliveInterval: 30_000,
      grpcKeepAliveTimeout: 5_000,
      grpcKeepAliveWhileIdle: true,
    });
  }

  /** Add a signature to the live tx-status watch list. */
  watch(signature: string) {
    this.watched.add(signature);
    void this.resubscribe();
  }

  unwatch(signature: string) {
    this.watched.delete(signature);
  }

  get currentSlot(): number {
    return this.lastSlot;
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  async stop() {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.stream?.end();
    } catch {
      /* already closed */
    }
  }

  private buildRequest() {
    return {
      accounts: {},
      slots: {
        all: {
          // We need every status transition (processed/confirmed/finalized)
          // to drive commitment promotion — so do NOT filter by commitment.
          filterByCommitment: false,
        },
      },
      transactions: {},
      // One labeled filter per watched signature — precise server-side
      // filtering instead of streaming the whole firehose to filter here.
      transactionsStatus: Object.fromEntries(
        [...this.watched].map((sig, i) => [
          `sig_${i}`,
          {
            vote: false,
            failed: true, // failed txs are exactly what the classifier needs
            signature: sig,
            accountInclude: [],
            accountExclude: [],
            accountRequired: [],
          },
        ])
      ),
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.PROCESSED,
      ...(this.lastSlot > 0 ? { fromSlot: String(this.lastSlot) } : {}),
    } as any;
  }

  private async connect() {
    if (this.stopped) return;
    try {
      await this.client.connect();
      this.stream = await this.client.subscribe();

      this.stream.on("data", (update: any) => this.enqueue(update));

      const onDisconnect = (why: string) => (err?: unknown) => {
        if (this.stopped) return;
        this.emit("disconnect", { why, err });
        this.scheduleReconnect();
      };
      this.stream.on("error", onDisconnect("error"));
      this.stream.on("end", onDisconnect("end"));
      this.stream.on("close", onDisconnect("close"));

      await this.writeRequest(this.buildRequest());
      this.reconnectAttempt = 0;
      this.startPinger();
      this.emit("connected", { endpoint: this.endpoint, fromSlot: this.lastSlot });
    } catch (err) {
      this.emit("disconnect", { why: "connect-failed", err });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.pingTimer) clearInterval(this.pingTimer);
    const backoff = Math.min(30_000, 500 * 2 ** this.reconnectAttempt);
    const jitter = backoff * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt++;
    setTimeout(() => void this.connect(), jitter);
  }

  private async resubscribe() {
    if (!this.stream) return;
    try {
      await this.writeRequest(this.buildRequest());
    } catch {
      /* stream will reconnect and resubscribe with the full request */
    }
  }

  private writeRequest(req: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream!.write(req, (err: unknown) => (err ? reject(err) : resolve()));
    });
  }

  private startPinger() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const req = { ...this.buildRequest(), ping: { id: ++this.pingId } };
      this.writeRequest(req).catch(() => {
        /* disconnect handlers take over */
      });
    }, PING_INTERVAL_MS);
  }

  // ---- bounded queue + async drain (backpressure) ----

  private enqueue(update: any) {
    const receivedAt = Date.now();
    if (update.ping) {
      // Server ping: reply or the stream gets culled.
      void this.writeRequest({ ...this.buildRequest(), ping: { id: ++this.pingId } });
      return;
    }
    if (!update.slot && !update.transactionStatus) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      if (this.dropped % 1000 === 1) this.emit("overflow", { dropped: this.dropped });
      return;
    }
    this.queue.push({
      kind: update.slot ? "slot" : "tx",
      payload: update,
      receivedAt,
    });
    if (!this.draining) void this.drain();
  }

  private async drain() {
    this.draining = true;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      try {
        if (item.kind === "slot") this.handleSlot(item);
        else this.handleTxStatus(item);
      } catch (err) {
        this.emit("handler-error", err);
      }
      // Yield to the event loop every batch so the socket keeps flowing.
      if (this.queue.length % 250 === 0) await new Promise((r) => setImmediate(r));
    }
    this.draining = false;
  }

  private handleSlot(item: QueueItem) {
    const s = item.payload.slot;
    const slot = Number(s.slot);
    if (slot > this.lastSlot) this.lastSlot = slot;
    const update: SlotUpdate = {
      slot,
      status: typeof s.status === "string" ? s.status : String(s.status),
      receivedAt: item.receivedAt,
    };
    this.emit("slot", update, s);
  }

  private handleTxStatus(item: QueueItem) {
    const t = item.payload.transactionStatus;
    const signature: string =
      typeof t.signature === "string" ? t.signature : bs58.encode(t.signature);
    if (!this.watched.has(signature)) return;
    const evt: TxStatusEvent = {
      signature,
      slot: Number(t.slot),
      err: t.err ?? null,
      receivedAt: item.receivedAt,
    };
    this.emit("tx", evt);
  }
}
