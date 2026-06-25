import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { DashboardServer, type ControlPlane, type PreflightResult } from "./dashboard/server.js";
import { runCampaign, useDashboard } from "./main.js";

/**
 * Persistent control console. The CLI (main.ts) runs one campaign and idles;
 * this stays up and turns the dashboard into an ops console — it serves the
 * live event stream AND exposes GET /preflight + POST /campaign/start, so a run
 * can be launched from the browser. A single-flight lock means only one
 * campaign runs at a time, and start refuses below the funding floor.
 *
 * Run: `npm run serve`. A launch spends real SOL — keep this on localhost and
 * never expose the port publicly.
 */

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(config.keypairPath, "utf8")))
);
const connection = new Connection(config.rpcUrl, "confirmed");

let running = false;
let server: DashboardServer;

// ~5k lamports base fee rides with every landed bundle alongside the tip.
const BASE_FEE_LAMPORTS = 5000;

async function preflight(): Promise<PreflightResult> {
  const balanceSol = (await connection.getBalance(payer.publicKey)) / 1e9;
  const landingCostSol = (config.typicalTipLamports + BASE_FEE_LAMPORTS) / 1e9;
  return {
    address: payer.publicKey.toBase58(),
    balanceSol,
    guardSol: config.minStartBalanceSol,
    ok: balanceSol >= config.minStartBalanceSol,
    landingCostSol,
    affordableBundles: Math.max(0, Math.floor(balanceSol / landingCostSol)),
  };
}

const control: ControlPlane = {
  preflight,
  async start({ bundles, faults }) {
    if (running) {
      return { status: 409, body: { error: "a campaign is already running" } };
    }
    const pf = await preflight();
    if (!pf.ok) {
      return {
        status: 400,
        body: { error: `payer balance ${pf.balanceSol} SOL is below the ${pf.guardSol} SOL floor — top up first`, ...pf },
      };
    }
    if (bundles > pf.affordableBundles) {
      return {
        status: 400,
        body: {
          error: `balance ~${pf.balanceSol.toFixed(4)} SOL covers about ${pf.affordableBundles} landed bundle(s) at ~${pf.landingCostSol.toFixed(4)} SOL each — reduce bundles to ${pf.affordableBundles} or top up`,
          ...pf,
        },
      };
    }

    running = true;
    server.reset(); // each launch is a fresh timeline
    server.publish("runstate", { state: "running", bundles, faults, startedAt: Date.now() });

    // Fire-and-forget: the campaign streams its own events. We only flip the
    // run flag back when it settles (success or failure) so the next launch is
    // allowed, and we never let a campaign rejection crash the console.
    void runCampaign({ totalBundles: bundles, faultCount: faults, payer, connection })
      .then((r) => server.publish("runstate", { state: "complete", ...r, finishedAt: Date.now() }))
      .catch((err) => {
        console.error("campaign failed:", err);
        server.publish("runstate", { state: "error", error: String(err), finishedAt: Date.now() });
      })
      .finally(() => {
        running = false;
      });

    return { status: 202, body: { started: true, bundles, faults, ...pf } };
  },
};

async function main() {
  server = new DashboardServer(config.dashboardPort, control);
  await server.start();
  useDashboard(server);
  server.publish("runstate", { state: "idle" });

  console.log(`Slipstream control console on ${server.url}`);
  console.log(`  GET  /preflight       → payer balance check`);
  console.log(`  POST /campaign/start  → launch { bundles, faults }`);
  console.log(`payer: ${payer.publicKey.toBase58()}`);
  console.log(`open the dashboard:  cd dashboard && npm run dev  →  http://localhost:3000/?live`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
