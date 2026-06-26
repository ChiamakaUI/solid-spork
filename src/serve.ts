import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { loadPayerKeypair } from "./keypair.js";
import { DashboardServer, type ControlPlane, type PreflightResult } from "./dashboard/server.js";
import { runCampaign, useDashboard } from "./main.js";

/** Persistent control console: serves the live event stream and launches campaigns via HTTP. */

const payer = loadPayerKeypair();
const connection = new Connection(config.rpcUrl, "confirmed");

let running = false;
let server: DashboardServer;

// Base fee per landed bundle, alongside the tip.
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

    // Fire-and-forget; flip the run flag back when the campaign settles.
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
  console.log(`  POST /campaign/start  → launch { bundles, faults } (needs x-control-token)`);
  console.log(
    config.controlToken
      ? `  campaign launches PROTECTED by CONTROL_TOKEN ✓`
      : `  ⚠ CONTROL_TOKEN unset — /campaign/start is DISABLED (set it to enable launches)`
  );
  console.log(`payer: ${payer.publicKey.toBase58()}`);
  console.log(`open the dashboard:  cd dashboard && npm run dev  →  http://localhost:3000/?live`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
