import GrpcDefault, { CommitmentLevel } from "@triton-one/yellowstone-grpc";
import { EventEmitter } from "node:events";
import { config } from "../config.js";
import type { SlotUpdate } from "../types.js";

// CJS/ESM interop: class arrives on `.default` under tsx/Node ESM.
const Client = ((GrpcDefault as any).default ?? GrpcDefault) as typeof GrpcDefault;
type GrpcClient = InstanceType<typeof GrpcDefault>;

/** Yellowstone gRPC slot stream with reconnect, keepalive ping, and backpressure. */

interface QueueItem {
  payload: any;
  receivedAt: number;
}

const MAX_QUEUE = 10_000;
const PING_INTERVAL_MS = 10_000;

export class GeyserStream extends EventEmitter {
  private client: GrpcClient;
  private stream: Awaited<ReturnType<GrpcClient["subscribe"]>> | null = null;
  private lastSlot = 0;
  private queue: QueueItem[] = [];
  private draining = false;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pingId = 0;
  public dropped = 0;

  constructor(
    private endpoint = config.grpcEndpoint,
    private xToken = config.grpcXToken
  ) {
    super();
    // Pin the v4 grpc-js client; raise receive cap and keep the HTTP/2 link alive.
    this.client = new Client(this.endpoint, this.xToken, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
      "grpc.keepalive_time_ms": 30_000,
      "grpc.keepalive_timeout_ms": 5_000,
      "grpc.keepalive_permit_without_calls": 1,
    });
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.stream?.end();
    } catch {
      /* already closed */
    }
  }

  private buildRequest() {
    return {
      accounts: {},
      // filterByCommitment=false so we see every status transition.
      slots: { all: { filterByCommitment: false } },
      transactions: {},
      transactionsStatus: {},
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
      // subscribe() establishes the HTTP/2 stream directly.
      this.stream = await this.client.subscribe();

      this.stream.on("data", (update: any) => this.enqueue(update));

      const dead = this.stream;
      const onDisconnect = (why: string) => (err?: unknown) => {
        if (this.stopped) return;
        // Detach all listeners so one broken stream schedules exactly one reconnect.
        dead.removeAllListeners();
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
    // Single-flight: don't stack a reconnect if one is already pending.
    if (this.reconnectTimer) return;
    if (this.pingTimer) clearInterval(this.pingTimer);
    const backoff = Math.min(30_000, 500 * 2 ** this.reconnectAttempt);
    const jitter = backoff * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, jitter);
  }

  private writeRequest(req: any): Promise<void> {
    return new Promise((resolve, reject) => {
      // Never write to a torn-down stream (avoids ERR_STREAM_WRITE_AFTER_END).
      if (this.stopped || !this.stream || (this.stream as any).writableEnded) return resolve();
      this.stream.write(req, (err: unknown) => (err ? reject(err) : resolve()));
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
    if (this.stopped) return; // ignore late data after teardown
    const receivedAt = Date.now();
    if (update.ping) {
      // Reply to server ping or the stream gets culled.
      void this.writeRequest({ ...this.buildRequest(), ping: { id: ++this.pingId } });
      return;
    }
    if (!update.slot) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      if (this.dropped % 1000 === 1) this.emit("overflow", { dropped: this.dropped });
      return;
    }
    this.queue.push({ payload: update, receivedAt });
    if (!this.draining) void this.drain();
  }

  private async drain() {
    this.draining = true;
    while (this.queue.length) {
      const item = this.queue.shift()!;
      try {
        this.handleSlot(item);
      } catch (err) {
        this.emit("handler-error", err);
      }
      // Yield to the event loop periodically so the socket keeps flowing.
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
    this.emit("slot", update);
  }
}
