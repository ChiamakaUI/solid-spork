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
  agentModel: env("AGENT_MODEL", "claude-sonnet-4-6"),

  /** Where lifecycle + agent logs are written. */
  logDir: env("LOG_DIR", "./logs"),

  network: "mainnet-beta" as const,

  /** Hard floor from Jito: bundles tipping below this are rejected. */
  jitoMinTipLamports: 1000,

  /**
   * Hard ceiling on a single tip (lamports). A budget guardrail: the agent
   * may escalate toward this when bundles repeatedly fail to land, but never
   * past it, so a runaway can't drain the payer. ~0.003 SOL.
   */
  maxTipLamports: 3_000_000,

  /** Max attempts per logical transaction (agent can abort earlier). */
  maxAttempts: 6,

  /** How long to wait for `processed` before treating the attempt as lost (ms). */
  processedTimeoutMs: 90_000,
};
