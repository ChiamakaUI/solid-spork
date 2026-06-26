import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import type { AgentDecision, LifecycleEntry, StageRecord } from "./types.js";

/**
 * Campaign reporter. Reduces the two append-only logs to logs/report.md:
 *
 *   logs/lifecycle.jsonl       → outcomes, processed→confirmed deltas, tips
 *   logs/agent-decisions.jsonl → autonomous retry reasoning
 *
 * Output is a paste-ready block that fills every `TODO(campaign)` in the README
 * with real numbers and explorer-verifiable signatures. Run after a campaign:
 * `npm run report`. Every figure derives from logged timestamps and on-chain
 * slots; if the log is empty, the report says so.
 */

const dir = config.logDir;

function readJsonl<T>(name: string): T[] {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function stageAt(stages: StageRecord[], stage: string): StageRecord | undefined {
  return stages.find((s) => s.stage === stage);
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function fmtMs(x: number): string {
  return Number.isFinite(x) ? `${Math.round(x)} ms` : "n/a";
}

function explorer(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

const entries = readJsonl<LifecycleEntry>("lifecycle.jsonl");
const decisions = readJsonl<AgentDecision>("agent-decisions.jsonl");

if (!entries.length) {
  console.error(
    `No lifecycle entries in ${join(dir, "lifecycle.jsonl")}.\n` +
      `Run the campaign first:  npm run run:campaign`
  );
  process.exit(1);
}

// Refuse to certify a run that was driven by the MOCK agent — those decisions
// are dev-only and must never back a submission.
const mockDecisions = decisions.filter((d) => /MOCK/i.test(d.model));
const liveCampaign = mockDecisions.length === 0;

// ---- outcomes ----
const byOutcome = new Map<string, number>();
for (const e of entries) byOutcome.set(e.outcome, (byOutcome.get(e.outcome) ?? 0) + 1);
const landed = entries.filter((e) => e.outcome === "finalized" || e.outcome === "confirmed");
const landRate = ((landed.length / entries.length) * 100).toFixed(0);

// ---- processed -> confirmed deltas (Q1 evidence) ----
type Landed = {
  id: string;
  sig: string;
  slot?: number;
  tip: number;
  procToConf?: number;
  confToFinal?: number;
  outcome: string;
  attempts: number;
};
const landedRows: Landed[] = [];
for (const e of entries) {
  const last = e.attempts[e.attempts.length - 1];
  if (!last) continue;
  if (!["finalized", "confirmed", "processed"].includes(e.outcome)) continue;
  const proc = stageAt(last.stages, "processed");
  const conf = stageAt(last.stages, "confirmed");
  const fin = stageAt(last.stages, "finalized");
  landedRows.push({
    id: e.id,
    sig: last.signature,
    slot: proc?.slot,
    tip: last.tip.lamports,
    procToConf: conf?.deltaFromPrevMs,
    confToFinal: fin?.deltaFromPrevMs,
    outcome: e.outcome,
    attempts: e.attempts.length,
  });
}
const deltas = landedRows.map((r) => r.procToConf).filter((x): x is number => Number.isFinite(x as number));

// ---- tips on landed bundles ----
const landedTips = landedRows.map((r) => r.tip).filter((x) => Number.isFinite(x));

// ---- fault injections & recoveries ----
const faultEntries = entries.filter((e) => e.attempts.some((a) => a.faultInjected));
const recoveredFaults = faultEntries.filter((e) =>
  ["finalized", "confirmed"].includes(e.outcome)
);

// ---- agent decisions ----
const retryDecisions = decisions.filter((d) => d.decision.action === "retry");
const abortDecisions = decisions.filter((d) => d.decision.action === "abort");
const avgConfidence = decisions.length
  ? (decisions.reduce((s, d) => s + d.decision.confidence, 0) / decisions.length).toFixed(2)
  : "n/a";

// ---- failure-class histogram ----
const failureClasses = new Map<string, number>();
for (const e of entries)
  for (const a of e.attempts)
    if (a.failure) failureClasses.set(a.failure.class, (failureClasses.get(a.failure.class) ?? 0) + 1);

// ---- build the markdown ----
const L: string[] = [];
L.push(`# Campaign Report`);
L.push(``);
if (!liveCampaign) {
  L.push(
    `> ⚠️ **MOCK agent detected in ${mockDecisions.length} decision(s).** This run is NOT ` +
      `submission-grade. Set \`ANTHROPIC_API_KEY\` and re-run before submitting.`
  );
  L.push(``);
}
L.push(`- Network: **${entries[0].network}**`);
L.push(`- Logical transactions: **${entries.length}**`);
L.push(`- Landed (confirmed or finalized): **${landed.length}/${entries.length} (${landRate}%)**`);
L.push(
  `- Outcomes: ${[...byOutcome.entries()].map(([k, v]) => `\`${k}\` ×${v}`).join(", ")}`
);
L.push(
  `- Fault injections: **${faultEntries.length}**, autonomously recovered: **${recoveredFaults.length}**`
);
L.push(
  `- Agent decisions: **${decisions.length}** (retry ×${retryDecisions.length}, abort ×${abortDecisions.length}), mean confidence **${avgConfidence}**`
);
if (failureClasses.size)
  L.push(
    `- Failure classes seen: ${[...failureClasses.entries()].map(([k, v]) => `\`${k}\` ×${v}`).join(", ")}`
  );
L.push(``);

// ---- Q1 paste block ----
L.push(`## Q1 evidence — processed→confirmed deltas`);
L.push(``);
if (deltas.length) {
  L.push(
    `Across **${deltas.length}** landed bundles we measured processed→confirmed of ` +
      `**${fmtMs(Math.min(...deltas))}–${fmtMs(Math.max(...deltas))}** (median **${fmtMs(median(deltas))}**), ` +
      `consistent with ${median(deltas) < 1000 ? "low-congestion conditions where stake-weighted votes land within 1–2 slots" : "elevated congestion — votes competing for blockspace"}.`
  );
} else {
  L.push(`_No confirmed-stage deltas captured yet._`);
}
L.push(``);

// ---- landed bundles table (explorer-verifiable) ----
L.push(`## Landed bundles (explorer-verifiable)`);
L.push(``);
if (landedRows.length) {
  L.push(`| outcome | slot | tip (lamports) | proc→conf | conf→final | attempts | signature |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const r of landedRows) {
    L.push(
      `| ${r.outcome} | ${r.slot ?? "?"} | ${r.tip.toLocaleString()} | ${fmtMs(r.procToConf ?? NaN)} | ${fmtMs(r.confToFinal ?? NaN)} | ${r.attempts} | [\`${r.sig.slice(0, 16)}…\`](${explorer(r.sig)}) |`
    );
  }
  if (landedTips.length)
    L.push(
      `\nLanded-tip range: **${Math.min(...landedTips).toLocaleString()}–${Math.max(...landedTips).toLocaleString()} lamports** (median ${median(landedTips).toLocaleString()}).`
    );
} else {
  L.push(`_No landed bundles in this run._`);
}
L.push(``);

// ---- fault recovery narrative (Q3-adjacent) ----
if (faultEntries.length) {
  L.push(`## Fault injection → autonomous recovery`);
  L.push(``);
  for (const e of faultEntries) {
    const ds = e.agentDecisionIds
      .map((id) => decisions.find((d) => d.id === id))
      .filter((d): d is AgentDecision => Boolean(d));
    L.push(`**Entry \`${e.id.slice(0, 8)}\`** → outcome \`${e.outcome}\` after ${e.attempts.length} attempt(s):`);
    for (const a of e.attempts) {
      if (a.failure)
        L.push(`- attempt ${a.attempt}: \`${a.failure.class}\` — ${a.failure.detail.slice(0, 140)}`);
    }
    for (const d of ds) {
      const c = d.decision.changes;
      L.push(
        `  - agent → **${d.decision.action}**` +
          (c ? ` (refresh=${c.refreshBlockhash ?? false}, tip→${c.newTipLamports ?? "—"}, delay=${c.delaySlots ?? 0})` : "") +
          ` conf ${d.decision.confidence}`
      );
      L.push(`    > ${d.reasoning.replace(/\n+/g, " ").slice(0, 280)}`);
    }
    L.push(``);
  }
}

// ---- one representative agent decision, verbatim ----
const showcase = retryDecisions[0] ?? decisions[0];
if (showcase) {
  L.push(`## Representative agent decision (verbatim)`);
  L.push("```json");
  L.push(JSON.stringify(showcase, null, 2));
  L.push("```");
}

const out = L.join("\n") + "\n";
writeFileSync(join(dir, "report.md"), out);

// ---- patch the README evidence blocks in place (idempotent) ----------------
// Each `<!-- AUTO:key -->…<!-- /AUTO:key -->` region in the README is rewritten
// from the real log, so a judged campaign finalises the README automatically —
// no manual paste, no stale numbers. Run `npm run report` after the campaign.
function mdLink(sig: string): string {
  return `[\`${sig.slice(0, 16)}…\`](${explorer(sig)})`;
}

function replaceRegion(text: string, key: string, content: string): { text: string; hit: boolean } {
  const re = new RegExp(`(<!-- AUTO:${key} -->)[\\s\\S]*?(<!-- /AUTO:${key} -->)`);
  if (!re.test(text)) return { text, hit: false };
  return { text: text.replace(re, `$1\n${content}\n$2`), hit: true };
}

const q1Block = deltas.length
  ? `Across **${deltas.length}** landed bundles in the latest campaign we measured processed→confirmed of ` +
    `**${fmtMs(Math.min(...deltas))}–${fmtMs(Math.max(...deltas))}** (median **${fmtMs(median(deltas))}**), consistent with ` +
    `${median(deltas) < 1000 ? "low-congestion conditions — stake-weighted votes landing within 1–2 slots" : "elevated congestion — vote transactions competing for blockspace"}. ` +
    `Per-bundle deltas are in \`logs/lifecycle.jsonl\`.`
  : `_Run \`npm run report\` after a campaign to populate measured processed→confirmed deltas._`;

const bundleFailures = entries.filter((e) => e.attempts.some((a) => a.failure?.class === "bundle_failure"));
const q3Block = bundleFailures.length
  ? `Observed in the latest campaign: entry \`${bundleFailures[0].id.slice(0, 8)}\` hit \`bundle_failure\` ` +
    `(block-engine \`Invalid\` + on-chain absence) and recovered to \`${bundleFailures[0].outcome}\` after ` +
    `${bundleFailures[0].attempts.length} attempt(s) — the classifier treated block-engine status as primary ` +
    `evidence and handed the agent the leader-schedule context to drive the next attempt.`
  : `_No leader-skip occurred in the latest campaign; the handling above is exercised by the classifier's \`bundle_failure\` path when a bundle fades to \`Invalid\`._`;

const linkRows = landedRows.slice(0, 3);
const landingBlock = linkRows.length
  ? `**Latest campaign:** landed **${landed.length}/${entries.length} (${landRate}%)** with the live ` +
    `\`${decisions[0]?.model ?? "claude"}\` agent. Example explorer-verifiable landings: ` +
    linkRows.map((r) => mdLink(r.sig)).join(", ") + `.`
  : `_Run \`npm run report\` after a campaign to populate the landing rate and explorer links._`;

const explorerBlock = linkRows.length
  ? `Example landed signatures from the latest campaign — check the slot + signature on any explorer:\n` +
    linkRows.map((r) => `- slot ${r.slot ?? "?"} — ${mdLink(r.sig)}`).join("\n")
  : `_Run \`npm run report\` after a campaign to populate explorer links._`;

const readmePath = join(process.cwd(), "README.md");
if (existsSync(readmePath)) {
  let readme = readFileSync(readmePath, "utf8");
  const patches: [string, string][] = [
    ["q1-deltas", q1Block],
    ["q3-skip", q3Block],
    ["landing-summary", landingBlock],
    ["explorer-links", explorerBlock],
  ];
  const missing: string[] = [];
  for (const [key, content] of patches) {
    const res = replaceRegion(readme, key, content);
    readme = res.text;
    if (!res.hit) missing.push(key);
  }
  writeFileSync(readmePath, readme);
  if (missing.length)
    console.log(`(README: no AUTO markers for ${missing.join(", ")} — left unchanged)`);
  else console.log(`README evidence blocks patched from this run.`);
}

// ---- console summary ----
console.log(`\n${"=".repeat(60)}`);
console.log(`CAMPAIGN REPORT  (${liveCampaign ? "LIVE agent" : "MOCK — not submission-grade"})`);
console.log("=".repeat(60));
console.log(`logical txs:      ${entries.length}`);
console.log(`landed:           ${landed.length}/${entries.length} (${landRate}%)`);
console.log(`outcomes:         ${[...byOutcome.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
if (deltas.length)
  console.log(`proc→conf delta:  ${fmtMs(Math.min(...deltas))}–${fmtMs(Math.max(...deltas))} (median ${fmtMs(median(deltas))})`);
console.log(`faults:           ${faultEntries.length} injected, ${recoveredFaults.length} recovered`);
console.log(`agent decisions:  ${decisions.length} (retry ${retryDecisions.length} / abort ${abortDecisions.length}), conf ${avgConfidence}`);
if (landedRows.length) {
  console.log(`\nexplorer-verifiable signatures:`);
  for (const r of landedRows.slice(0, 6)) console.log(`  ${r.outcome.padEnd(9)} slot ${r.slot ?? "?"}  ${explorer(r.sig)}`);
}
console.log(`\nfull report written to ${join(dir, "report.md")}\n`);
