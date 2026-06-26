/** Smoke test: verifies geyser, tip engine, and Jito gRPC integrations with zero SOL. */
import { GeyserStream } from "./stream/geyser.js";
import { TipEngine } from "./tip/engine.js";
import { JitoClient } from "./jito/client.js";

const stream = new GeyserStream();
const tips = new TipEngine();
let slots = 0;

stream.on("connected", (e) => console.log("✓ geyser connected:", JSON.stringify(e)));
stream.on("disconnect", (e) => console.log("✗ geyser disconnect:", e.why, String(e.err ?? "")));
stream.on("slot", (u) => {
  tips.observeSlot(u.receivedAt);
  if (++slots <= 5 || slots % 50 === 0)
    console.log(`  slot ${u.slot} status=${u.status} (+${slots} updates)`);
});

await stream.start();
await new Promise((r) => setTimeout(r, 15_000));
console.log(`✓ received ${slots} slot updates in 15s, current slot ${stream.currentSlot}`);

const snap = await tips.refresh();
console.log("✓ tip floor:", JSON.stringify(snap));
const decision = await tips.decide("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5");
console.log("✓ tip decision:", JSON.stringify(decision));

const jito = new JitoClient();
try {
  const accounts = await jito.getTipAccounts();
  console.log(`✓ jito tip accounts (${accounts.length}):`, accounts.slice(0, 2).join(", "), "…");
  const leader = await jito.nextScheduledLeader();
  console.log("✓ next jito leader:", JSON.stringify(leader), `(gap: ${leader.nextLeaderSlot - leader.currentSlot} slots)`);
} catch (err) {
  console.log("✗ jito gRPC:", String(err));
}

await stream.stop();
process.exit(0);
