/**
 * Deterministic probe for the retry agent's decision-making.
 *
 * Drives RetryAgent.decide() through a battery of hand-built failure
 * scenarios — the exact decision points SYSTEM_PROMPT is engineered around —
 * so you can watch every branch (refresh, escalate, abort-at-cap) without
 * running a live Solana campaign and without waiting for those rare cases to
 * occur naturally.
 *
 * Cost:
 *   no ANTHROPIC_API_KEY  -> agent runs MOCK            -> $0
 *   ANTHROPIC_API_KEY set -> one API call per scenario  -> ~2c for all 5 on
 *                            Haiku, ~5c on Sonnet
 *
 * Placement: src/agent/scenarios.ts   (sits next to agent.ts)
 * Run all:   npx tsx src/agent/scenarios.ts
 * Run one:   npx tsx src/agent/scenarios.ts p99_already_paid_still_failing
 * Cheap live pass:
 *   AGENT_MODEL=claude-haiku-4-5-20251001 ANTHROPIC_API_KEY=sk-... \
 *     npx tsx src/agent/scenarios.ts
 *
 * The `expect` line on each scenario describes what a GOOD decision from a
 * real model looks like — it is for your eyes, not asserted. Mock mode is
 * deterministic and simple; it is there to prove plumbing, not judgement.
 *
 * Constants below mirror config.ts: maxTipLamports 3_000_000, maxAttempts 6,
 * jitoMinTipLamports 1000. With p99 = 500k and the cap at 3M there is ~6x of
 * headroom, so the "escalate 3-6x" behaviour the prompt asks for fits under
 * the cap — near_cap_still_failing is the one case where it has run out.
 */

import { RetryAgent, type AgentContext } from "./agent.js";

interface Scenario {
  name: string;
  expect: string;
  ctx: AgentContext;
}

// Illustrative Jito tip percentiles (lamports). Tune to your real snapshots.
const PCT = { p25: 1_000, p50: 10_000, p75: 50_000, p95: 200_000, p99: 500_000 };
const MAX_TIP = 3_000_000; // config.maxTipLamports (~0.003 SOL)
const MAX_ATTEMPTS = 6; // config.maxAttempts

const scenarios: Scenario[] = [
  {
    name: "expired_blockhash_stale",
    expect: "retry with refreshBlockhash=true — blockhash is past ~150 slots, a resubmit without refresh is guaranteed to fail",
    ctx: {
      entryId: "scn-expired",
      attempt: 2,
      maxAttempts: MAX_ATTEMPTS,
      failureClass: "expired_blockhash",
      failureDetail: "blockhash no longer valid on-chain at submit time",
      currentSlot: 100_300,
      slotsSinceBlockhashFetch: 190,
      lastTipLamports: 50_000,
      tipPercentiles: PCT,
      maxTipLamports: MAX_TIP,
      congestionFactor: 1.2,
      attemptHistory: [
        { attempt: 1, tipLamports: 50_000, outcome: "failed", failureClass: "expired_blockhash" },
      ],
    },
  },
  {
    name: "fee_too_low_below_floor",
    expect: "retry, raise tip toward/above the percentiles — last tip was below p75 and the bundle never landed",
    ctx: {
      entryId: "scn-feelow",
      attempt: 2,
      maxAttempts: MAX_ATTEMPTS,
      failureClass: "fee_too_low",
      failureDetail: "bundle stayed pending; tip below inclusion floor",
      currentSlot: 100_050,
      slotsSinceBlockhashFetch: 30,
      lastTipLamports: 20_000,
      tipPercentiles: PCT,
      maxTipLamports: MAX_TIP,
      congestionFactor: 1.5,
      attemptHistory: [
        { attempt: 1, tipLamports: 20_000, outcome: "failed", failureClass: "fee_too_low" },
      ],
    },
  },
  {
    name: "p99_already_paid_still_failing",
    expect: "MULTIPLICATIVE escalation (~3-6x, still under the 3M cap), not a timid bump — two attempts at/above p99 already failed, so small increments just burn attempts",
    ctx: {
      entryId: "scn-p99",
      attempt: 3,
      maxAttempts: MAX_ATTEMPTS,
      failureClass: "bundle_failure",
      failureDetail: "bundle never reached processed across two attempts at/above p99",
      currentSlot: 100_120,
      slotsSinceBlockhashFetch: 40,
      lastTipLamports: 500_000, // == p99
      tipPercentiles: PCT,
      maxTipLamports: MAX_TIP,
      congestionFactor: 2.0,
      attemptHistory: [
        { attempt: 1, tipLamports: 200_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 2, tipLamports: 500_000, outcome: "failed", failureClass: "bundle_failure" },
      ],
    },
  },
  {
    name: "near_cap_still_failing",
    expect: "likely ABORT — a near-cap tip still not landing points at the unauthenticated connection, not the tip; escalation has nowhere left to go under the 3M cap",
    ctx: {
      entryId: "scn-nearcap",
      attempt: 5,
      maxAttempts: MAX_ATTEMPTS,
      failureClass: "bundle_failure",
      failureDetail: "near-cap tip still not landing on unauthenticated connection",
      currentSlot: 100_200,
      slotsSinceBlockhashFetch: 50,
      lastTipLamports: 2_800_000, // just under MAX_TIP
      tipPercentiles: PCT,
      maxTipLamports: MAX_TIP,
      congestionFactor: 2.5,
      attemptHistory: [
        { attempt: 1, tipLamports: 500_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 2, tipLamports: 1_200_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 3, tipLamports: 2_000_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 4, tipLamports: 2_800_000, outcome: "failed", failureClass: "bundle_failure" },
      ],
    },
  },
  {
    name: "budget_exhausted",
    expect: "ABORT — attempt == maxAttempts, no budget left to change anything",
    ctx: {
      entryId: "scn-exhausted",
      attempt: 6,
      maxAttempts: MAX_ATTEMPTS,
      failureClass: "bundle_failure",
      failureDetail: "final attempt failed",
      currentSlot: 100_260,
      slotsSinceBlockhashFetch: 60,
      lastTipLamports: 2_000_000,
      tipPercentiles: PCT,
      maxTipLamports: MAX_TIP,
      congestionFactor: 1.8,
      attemptHistory: [
        { attempt: 1, tipLamports: 100_000, outcome: "failed", failureClass: "fee_too_low" },
        { attempt: 2, tipLamports: 300_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 3, tipLamports: 700_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 4, tipLamports: 1_200_000, outcome: "failed", failureClass: "bundle_failure" },
        { attempt: 5, tipLamports: 2_000_000, outcome: "failed", failureClass: "bundle_failure" },
      ],
    },
  },
];

const fmtLamports = (n?: number) =>
  n === undefined ? "—" : `${n.toLocaleString()} lamports (${(n / 1e9).toFixed(6)} SOL)`;

async function run(): Promise<void> {
  const filter = process.argv[2];
  const chosen = filter ? scenarios.filter((s) => s.name === filter) : scenarios;
  if (filter && chosen.length === 0) {
    console.error(`no scenario "${filter}". available:\n  ${scenarios.map((s) => s.name).join("\n  ")}`);
    process.exit(1);
  }

  const agent = new RetryAgent();
  const paid = agent.mode === "live";
  console.log(
    `\nagent mode: ${agent.mode.toUpperCase()}` +
      (paid ? "  (one paid API call per scenario)" : "  ($0 — no API key set)")
  );
  console.log(`scenarios: ${chosen.length}\n${"=".repeat(76)}`);

  let aborts = 0;
  let capBreaches = 0;

  for (const s of chosen) {
    console.log(`\n> ${s.name}`);
    console.log(`  failure:   ${s.ctx.failureClass} — ${s.ctx.failureDetail}`);
    console.log(`  attempt:   ${s.ctx.attempt}/${s.ctx.maxAttempts}   lastTip ${fmtLamports(s.ctx.lastTipLamports)}`);
    console.log(`  blockhash: ${s.ctx.slotsSinceBlockhashFetch} slots old (dies ~150)`);
    console.log(`  expect:    ${s.expect}`);

    try {
      const d = await agent.decide(s.ctx);
      const dec = d.decision;
      console.log(`  -- decision [${d.model}] --`);
      console.log(`  action:     ${dec.action}   confidence ${dec.confidence}`);
      if (dec.action === "abort") aborts++;

      if (dec.action === "retry" && dec.changes) {
        const c = dec.changes;
        const ratio =
          c.newTipLamports !== undefined && s.ctx.lastTipLamports
            ? `  (${(c.newTipLamports / s.ctx.lastTipLamports).toFixed(2)}x last)`
            : "";
        console.log(`  refresh:    ${c.refreshBlockhash ?? false}`);
        console.log(`  newTip:     ${fmtLamports(c.newTipLamports)}${ratio}`);
        console.log(`  delaySlots: ${c.delaySlots ?? 0}`);
        if (c.otherAdjustments) console.log(`  other:      ${c.otherAdjustments}`);

        // The orchestrator clamps to maxTipLamports; surface proposals that
        // would be clamped so you can see whether the model respects the cap.
        if (c.newTipLamports !== undefined && c.newTipLamports > s.ctx.maxTipLamports) {
          capBreaches++;
          console.log(
            `  WARN: proposed tip exceeds maxTipLamports (${fmtLamports(s.ctx.maxTipLamports)}); orchestrator will clamp`
          );
        }
      }

      console.log(`  rejected:   ${dec.rejectedAlternatives.join(" | ") || "—"}`);
      console.log(`  reasoning:  ${d.reasoning.replace(/\s+/g, " ").trim()}`);
    } catch (err) {
      console.error(`  FAILED: decide() threw: ${String(err)}`);
    }
  }

  console.log(
    `\n${"=".repeat(76)}\ndone — ${chosen.length} scenarios, ${aborts} abort(s)` +
      (capBreaches ? `, ${capBreaches} over-cap proposal(s)` : "") +
      `\n`
  );
}

run();