import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

/** Live dashboard data plane over Node http + Server-Sent Events. */

export type DashEventType =
  | "campaign"
  | "slot"
  | "tipfloor"
  | "leader"
  | "health"
  | "attempt"
  | "stage"
  | "failure"
  | "decision"
  | "leadercheck"
  | "outcome"
  | "done"
  | "runstate"
  | "log";

interface Envelope {
  t: DashEventType;
  ts: number;
  d: unknown;
}

/** Result of a payer-balance preflight, returned by GET /preflight. */
export interface PreflightResult {
  address: string;
  balanceSol: number;
  guardSol: number;
  /** balanceSol is at or above the hard funding floor (guardSol). */
  ok: boolean;
  /** Estimated cost of one landed bundle (SOL); see config.typicalTipLamports. */
  landingCostSol: number;
  /** How many bundles the current balance can fund: floor(balance / landingCost). */
  affordableBundles: number;
}

/** Command surface the server exposes when running as the control console. */
export interface ControlPlane {
  preflight(): Promise<PreflightResult>;
  /** Begin a campaign if idle and funded; returns the HTTP status + JSON body to send. */
  start(opts: { bundles: number; faults: number }): Promise<{ status: number; body: unknown }>;
}

const PERSISTED = new Set<DashEventType>([
  "campaign",
  "attempt",
  "stage",
  "failure",
  "decision",
  "leadercheck",
  "outcome",
  "done",
  "log",
]);

const MAX_BUFFER = 6000;

export class DashboardServer {
  private server: Server | null = null;
  private clients = new Set<ServerResponse>();
  private buffer: Envelope[] = [];
  /** Most-recent of each latest-only signal, replayed to new clients. */
  private latest = new Map<DashEventType, Envelope>();

  constructor(
    private port = config.dashboardPort,
    private control?: ControlPlane
  ) {}

  async start(): Promise<number> {
    // A request handler must never crash the process: any route error (e.g. a
    // transient RPC fetch in /preflight) becomes a 500, not a process exit.
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error("request handler error:", String(err));
        try {
          if (!res.headersSent) res.writeHead(500, { "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ error: "internal error" }));
        } catch { /* response already torn down */ }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, () => resolve());
    });
    return this.port;
  }

  stop() {
    for (const c of this.clients) {
      try { c.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
    this.server?.close();
  }

  /** Push an event to every connected browser (and buffer it if persisted). */
  publish(t: DashEventType, d: unknown) {
    const env: Envelope = { t, ts: Date.now(), d };
    if (PERSISTED.has(t)) {
      this.buffer.push(env);
      if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    } else {
      this.latest.set(t, env);
    }
    const line = `data: ${JSON.stringify(env)}\n\n`;
    for (const c of this.clients) {
      try { c.write(line); } catch { /* dropped client; cleaned on close */ }
    }
  }

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  /** Clear buffered + latest events so the next campaign replays as a fresh timeline. */
  reset() {
    this.buffer = [];
    this.latest.clear();
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0];

    // CORS preflight for cross-origin control routes.
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      }).end();
      return;
    }

    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset=utf-8><title>Slipstream live API</title>` +
          `<body style="background:#0a0e12;color:#c8d6e0;font:14px ui-monospace,Menlo,monospace;padding:2rem">` +
          `<h2 style="color:#34e0d8">Slipstream — live event API</h2>` +
          `<p>This port streams campaign events. Open the dashboard UI (Next.js app in <code>dashboard/</code>) and point it here.</p>` +
          `<ul><li><code>GET /events</code> — Server-Sent Events stream (replayed on connect)</li>` +
          (this.control ? `<li><code>GET /preflight</code> — payer balance check</li><li><code>POST /campaign/start</code> — launch a campaign</li>` : ``) +
          `<li><code>GET /logs/lifecycle.jsonl</code></li><li><code>GET /logs/agent-decisions.jsonl</code></li></ul>` +
          `<p>Live clients connected: ${this.clients.size}</p></body>`
      );
      return;
    }
    if (path === "/events") {
      this.openStream(res);
      return;
    }
    if (path.startsWith("/logs/")) {
      this.serveLog(path.slice("/logs/".length), res);
      return;
    }
    // Control routes exist only when a ControlPlane was supplied.
    if (this.control && path === "/preflight" && method === "GET") {
      const pf = await this.control.preflight();
      this.sendJson(res, 200, pf);
      return;
    }
    if (this.control && path === "/campaign/start" && method === "POST") {
      await this.handleStart(req, res);
      return;
    }
    res.writeHead(404).end("not found");
  }

  private async handleStart(req: IncomingMessage, res: ServerResponse) {
    let body: { bundles?: number; faults?: number } = {};
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      this.sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    const bundles = Number(body.bundles);
    const faults = Number(body.faults ?? 0);
    if (!Number.isInteger(bundles) || bundles < 1 || bundles > 50) {
      this.sendJson(res, 400, { error: "bundles must be an integer in 1..50" });
      return;
    }
    if (!Number.isInteger(faults) || faults < 0 || faults > bundles) {
      this.sendJson(res, 400, { error: "faults must be an integer in 0..bundles" });
      return;
    }
    const { status, body: payload } = await this.control!.start({ bundles, faults });
    this.sendJson(res, status, payload);
  }

  private sendJson(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(body));
  }

  private openStream(res: ServerResponse) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    res.write(`retry: 2000\n\n`);
    // Replay: latest-only snapshots first, then the full persisted timeline.
    for (const env of this.latest.values()) res.write(`data: ${JSON.stringify(env)}\n\n`);
    for (const env of this.buffer) res.write(`data: ${JSON.stringify(env)}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  private serveLog(name: string, res: ServerResponse) {
    // Only the two known log files, no traversal.
    if (name !== "lifecycle.jsonl" && name !== "agent-decisions.jsonl") {
      res.writeHead(404).end("not found");
      return;
    }
    const p = join(config.logDir, name);
    if (!existsSync(p)) {
      res.writeHead(200, { "content-type": "application/x-ndjson" }).end("");
      return;
    }
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "access-control-allow-origin": "*",
    });
    res.end(readFileSync(p));
  }
}

/** Read a request body to a string, capped so a bad client can't exhaust memory. */
function readBody(req: IncomingMessage, limit = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
