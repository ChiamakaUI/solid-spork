import "dotenv/config";

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  /** Yellowstone gRPC endpoint. PublicNode's free endpoint works with no token. */
  grpcEndpoint: env("GRPC_ENDPOINT", "https://solana-yellowstone-grpc.publicnode.com:443"),
  grpcXToken: process.env.GRPC_X_TOKEN || undefined,

  /** Standard JSON-RPC endpoint (blockhash, leader schedule, cross-checks). */
  rpcUrl: env("RPC_URL", "https://api.mainnet-beta.solana.com"),

  /**
   * Jito block engine. Pin ONE region rather than the global anycast endpoint:
   * anycast can route getNextScheduledLeader and sendBundle to different
   * physical relays, so the leader you time your window against isn't the relay
   * you send to — the 2-slot timing becomes meaningless. Amsterdam measured
   * lowest-latency from here (337ms TLS RTT); override per deployment region.
   */
  blockEngineUrl: env("BLOCK_ENGINE_URL", "amsterdam.mainnet.block-engine.jito.wtf"),
  blockEngineHttp: env("BLOCK_ENGINE_HTTP", "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles"),
  tipFloorUrl: env("TIP_FLOOR_URL", "https://bundles.jito.wtf/api/v1/bundles/tip_floor"),

  /**
   * Optional x-jito-auth API key (apply at the Jito searcher form). Raises the
   * per-IP rate limit above the unauthenticated 1 req/s/region; default sends
   * work without it. When set, it's attached to every HTTP block-engine call.
   */
  jitoAuthKey: process.env.JITO_AUTH_KEY || undefined,

  /**
   * Optional searcher keypair for gRPC challenge-response auth. Separate from
   * the payer; only needed if you've been allowlisted. Unset = default
   * (unauthenticated) sends, which Jito officially supports.
   */
  jitoAuthKeypairPath: process.env.JITO_AUTH_KEYPAIR_PATH || undefined,

  /** Path to the payer keypair (JSON array of secret-key bytes). */
  keypairPath: env("KEYPAIR_PATH", "./payer.keypair.json"),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  // Haiku 4.5 is the default: the agent fires only on failures (a handful of
  // calls/campaign) and the decision is tightly constrained by the SYSTEM_PROMPT
  // and structured output, so the cheapest capable model is the right call —
  // cost is cents, latency is lower, and the escalation policy holds. Set
  // AGENT_MODEL=claude-sonnet-4-6 if you want richer free-form reasoning.
  agentModel: env("AGENT_MODEL", "claude-haiku-4-5"),

  /** Where lifecycle + agent logs are written. */
  logDir: env("LOG_DIR", "./logs"),

  /** Live dashboard port (SSE + UI). Open http://localhost:<port> during a run. */
  dashboardPort: parseInt(env("DASHBOARD_PORT", "8088"), 10),

  network: "mainnet-beta" as const,

  /** Hard floor from Jito: bundles tipping below this are rejected. */
  jitoMinTipLamports: 1000,

  /**
   * Hard ceiling on a single tip (lamports). A budget guardrail: the agent
   * may escalate toward this when bundles repeatedly fail to land, but never
   * past it, so a runaway can't drain the payer. 4M ≈ 0.004 SOL — set above the
   * measured auction p99 (~2.95M) so a competitive tip can actually WIN the
   * auction; a 2-bundle diagnostic worst case is ~0.008 SOL.
   */
  maxTipLamports: 4_000_000,

  /** Max attempts per logical transaction (agent can abort earlier). */
  maxAttempts: 6,

  /** Refuse to start a campaign below this payer balance (SOL). */
  minStartBalanceSol: 0.01,

  /**
   * Expected tip per LANDED bundle (lamports), used only to estimate a run's
   * cost in the control-console preflight. On the unauthenticated public block
   * engine, observed landings cost ~3.0–3.6M (well above published
   * percentiles); failed attempts are free, so total run cost ≈ bundles × this.
   */
  typicalTipLamports: 3_200_000,

  /**
   * How long to wait for `processed` before treating the attempt as lost (ms).
   * A Jito bundle lands within a couple slots of its targeted leader or not at
   * all, so a short window detects non-landing fast (and keeps the blockhash
   * fresh for the agent's next attempt). Env-overridable for quick campaigns.
   */
  processedTimeoutMs: parseInt(env("PROCESSED_TIMEOUT_MS", "90000"), 10),

  /**
   * getSignatureStatuses poll interval during landing detection. Kept tight
   * (250 ms) so we sample `processed` before the chain jumps to `confirmed`,
   * preserving a real processed→confirmed delta for Q1 — at a coarse interval
   * both levels land in one poll and the delta collapses to ~0 ms.
   */
  pollIntervalMs: parseInt(env("POLL_INTERVAL_MS", "250"), 10),
};
