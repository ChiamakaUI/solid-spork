/** Quick gRPC endpoint probe: connect, stream slots for ~12s, report. */
import { GeyserStream } from "./stream/geyser.js";

const endpoint = process.argv[2];
const xToken = process.argv[3] || undefined;
if (!endpoint) {
  console.error("usage: tsx src/probe-grpc.ts <endpoint> [xToken]");
  process.exit(2);
}

const stream = new GeyserStream(endpoint, xToken);
let slots = 0;
let firstAt = 0;
const errs = new Set<string>();

stream.on("connected", () => console.log(`  connected → ${endpoint}`));
stream.on("disconnect", (e) => errs.add(`${e.why}: ${String(e.err ?? "").slice(0, 80)}`));
stream.on("slot", () => {
  if (!firstAt) firstAt = Date.now();
  slots++;
});

const start = Date.now();
await stream.start();
await new Promise((r) => setTimeout(r, 12_000));
await stream.stop();

const live = slots > 0;
console.log(
  `RESULT ${endpoint}: ${live ? "✓ LIVE" : "✗ DEAD"}  slots=${slots}  ` +
    `currentSlot=${stream.currentSlot}  ttfs=${firstAt ? firstAt - start : "—"}ms` +
    (errs.size ? `  errors=[${[...errs].join(" | ")}]` : "")
);
process.exit(live ? 0 : 1);
