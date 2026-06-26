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

  /** Jito block engine. Pin ONE region rather than the global anycast endpoint. */
  blockEngineUrl: env("BLOCK_ENGINE_URL", "amsterdam.mainnet.block-engine.jito.wtf"),
  blockEngineHttp: env("BLOCK_ENGINE_HTTP", "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles"),
  tipFloorUrl: env("TIP_FLOOR_URL", "https://bundles.jito.wtf/api/v1/bundles/tip_floor"),

  /** Optional x-jito-auth API key; raises the per-IP rate limit above 1 req/s. */
  jitoAuthKey: process.env.JITO_AUTH_KEY || undefined,

  /** Optional searcher keypair for gRPC challenge-response auth. */
  jitoAuthKeypairPath: process.env.JITO_AUTH_KEYPAIR_PATH || undefined,

  /** Path to the payer keypair (JSON array of secret-key bytes). */
  keypairPath: env("KEYPAIR_PATH", "./payer.keypair.json"),

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  // Haiku 4.5 default (agent fires only on failures); set AGENT_MODEL=claude-sonnet-4-6 for richer reasoning.
  agentModel: env("AGENT_MODEL", "claude-haiku-4-5"),

  /** Where lifecycle + agent logs are written. */
  logDir: env("LOG_DIR", "./logs"),

  /** Live dashboard port (SSE + UI). Open http://localhost:<port> during a run. */
  dashboardPort: parseInt(env("DASHBOARD_PORT", "8088"), 10),

  network: "mainnet-beta" as const,

  /** Hard floor from Jito: bundles tipping below this are rejected. */
  jitoMinTipLamports: 1000,

  /** Hard ceiling on a single tip (lamports). Budget guardrail the agent can't exceed. */
  maxTipLamports: 4_000_000,

  /** Max attempts per logical transaction (agent can abort earlier). */
  maxAttempts: 6,

  /** Refuse to start a campaign below this payer balance (SOL). */
  minStartBalanceSol: 0.01,

  /** Expected tip per landed bundle (lamports); used for the preflight cost estimate. */
  typicalTipLamports: 3_200_000,

  /** How long to wait for `processed` before treating the attempt as lost (ms). */
  processedTimeoutMs: parseInt(env("PROCESSED_TIMEOUT_MS", "90000"), 10),

  /** getSignatureStatuses poll interval during landing detection (ms). */
  pollIntervalMs: parseInt(env("POLL_INTERVAL_MS", "250"), 10),
};
