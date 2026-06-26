# Campaign Report

- Network: **mainnet-beta**
- Logical transactions: **8**
- Landed (confirmed or finalized): **8/8 (100%)**
- Outcomes: `finalized` ×8
- Fault injections: **2**, autonomously recovered: **2**
- Agent decisions: **15** (retry ×15, abort ×0), mean confidence **0.75**
- Failure classes seen: `bundle_failure` ×15

## Q1 evidence — processed→confirmed deltas

Across **8** landed bundles we measured processed→confirmed of **0 ms–1 ms** (median **0 ms**), consistent with low-congestion conditions where stake-weighted votes land within 1–2 slots.

## Landed bundles (explorer-verifiable)

| outcome | slot | tip (lamports) | proc→conf | conf→final | attempts | signature |
|---|---|---|---|---|---|---|
| finalized | 428772323 | 3,200,000 | 0 ms | 11613 ms | 2 | [`3NDDQAtPkUnaQCj5…`](https://solscan.io/tx/3NDDQAtPkUnaQCj5jkpZocRajihBFZY5kQQ1VcwkMS352EgvEwqiSGgqawCiF93dE4KWL9fHawXF3KW3woaDDP6F) |
| finalized | 428772942 | 3,600,000 | 1 ms | 12152 ms | 3 | [`32LoW93VuqcaTV9r…`](https://solscan.io/tx/32LoW93VuqcaTV9r53JgAvUeYCk8qdrzsjpFMMKfQQTEPehBCnFYStk1V225EEBfSaSCuBurds8wvu8UH3wcJJVu) |
| finalized | 428773465 | 3,600,000 | 1 ms | 11533 ms | 3 | [`4PG8B6ATWZs8WjWm…`](https://solscan.io/tx/4PG8B6ATWZs8WjWmAZXwyeTEMVsTYNCo9XsDRUhGkyNkmqYxfRBa8mahxxnj6jQH9bGRWTsNCXyucxv4n464wCBq) |
| finalized | 428774343 | 3,900,000 | 0 ms | 12093 ms | 4 | [`26S4ihoCFynjEGjL…`](https://solscan.io/tx/26S4ihoCFynjEGjLuRniDquBXHbJ9QdTXfjDprmjL7kkSKW446hyt3ivBaWsh9hEJmmYmYdAwRZJzzj6rSzGVmAc) |
| finalized | 428774655 | 3,400,000 | 0 ms | 12157 ms | 2 | [`2W8wr6Uwyjcw3swk…`](https://solscan.io/tx/2W8wr6Uwyjcw3swko332BvprepK8gAVKZuo13gvB52PRjwjjCZHVgCq5hmUWLAT1MwpjjJnK9wNeSw4ctDYTidTn) |
| finalized | 428775252 | 2,800,000 | 0 ms | 11360 ms | 3 | [`ZhWjuAdLdGCPZpde…`](https://solscan.io/tx/ZhWjuAdLdGCPZpdeRkKsn4jpvGUZMTCRdXZG2439QNPmAHbChoXnQmyMyBWyaxeVAbBHdSDrgnggSQyQWPGStoK) |
| finalized | 428775778 | 3,200,000 | 1 ms | 12080 ms | 3 | [`3TYFgDnSjL7bwKMU…`](https://solscan.io/tx/3TYFgDnSjL7bwKMUkTdE5R9yewFYNEE9j8HPad5tz9PUCyqYw3Vd2BdW4cWEj23KeZZkBi78xAPoAjL6RPrqKw7k) |
| finalized | 428776388 | 3,600,000 | 0 ms | 12583 ms | 3 | [`4uTiH2ibaatmoaSt…`](https://solscan.io/tx/4uTiH2ibaatmoaStKiYS7NNN4knT1epjY68fLDh4SJTrCvQEG1Gn7kpXPKp2ieJruupVrt1z3yHCEucSVn1Y3iyK) |

Landed-tip range: **2,800,000–3,900,000 lamports** (median 3,600,000).

## Fault injection → autonomous recovery

**Entry `cfe473bb`** → outcome `finalized` after 3 attempt(s):
- attempt 1: `bundle_failure` — unmapped tx error: {"sendError":"Error: jito-ts error: SearcherClientError: Invalid argument provided: bundle contains an expired blockhash"
- attempt 2: `bundle_failure` — block engine reported Invalid — bundle dropped before/at auction (blockhash also expired by detection time)
  - agent → **retry** (refresh=true, tip→1630, delay=0) conf 0.92
    >  ROOT CAUSE ANALYSIS: The failure is clear and unmapped: "bundle contains an expired blockhash". The current slot is 428773148, and slotsSinceBlockhashFetch is 166 slots. Since a blockhash is valid for ~150 slots, this blockhash has EXPIRED — it was fetched ~166 slots ago and is 
  - agent → **retry** (refresh=true, tip→3600000, delay=3) conf 0.75
    >  FAILURE ANALYSIS: - Attempt 2 failed with failureClass "bundle_failure" — the bundle was dropped before/at auction (never reached processed state). - The failureDetail explicitly states the blockhash expired by detection time, which is a critical secondary factor. - slotsSinceBl

**Entry `c3d3a6bc`** → outcome `finalized` after 3 attempt(s):
- attempt 1: `bundle_failure` — unmapped tx error: {"sendError":"Error: jito-ts error: SearcherClientError: Invalid argument provided: bundle contains an expired blockhash"
- attempt 2: `bundle_failure` — block engine reported Invalid — bundle dropped before/at auction (blockhash also expired by detection time)
  - agent → **retry** (refresh=true, tip→1438, delay=0) conf 0.85
    >  **What failed:** The bundle was rejected with "bundle contains an expired blockhash" — a clear, deterministic failure caused by attempting submission after the blockhash validity window closed. **Why it failed:** The slotsSinceBlockhashFetch = 167 slots, which exceeds the ~150-s
  - agent → **retry** (refresh=true, tip→3200000, delay=2) conf 0.85
    >  FAILURE ANALYSIS: - Attempt 2 failed with failureClass "bundle_failure" — the bundle was dropped before/at auction (Invalid). - Critical detail: blockhash EXPIRED by detection time (slotsSinceBlockhashFetch = 232 slots, well beyond the ~150-slot window). - This is a dual failure

## Representative agent decision (verbatim)
```json
{
  "id": "d8aad389-7c6b-445f-bb1d-91e44c02cafd",
  "at": 1782376898520,
  "trigger": {
    "entryId": "0a6207fe-f251-4d61-a67a-cbe85d159633",
    "attempt": 1,
    "failureClass": "bundle_failure",
    "failureDetail": "block engine reported Invalid — bundle dropped before/at auction (blockhash also expired by detection time)",
    "networkContext": {
      "currentSlot": 428772270,
      "recentTipPercentiles": {
        "p25": 1000,
        "p50": 1639,
        "p75": 2535,
        "p95": 12052,
        "p99": 629464
      },
      "slotsSinceBlockhashFetch": 238,
      "attemptsSoFar": 1
    }
  },
  "reasoning": "\n**Failure Analysis:**\nThe bundle was dropped before/at auction with an \"Invalid\" report, and the blockhash expired by detection time. This is a compound failure: (1) blockhash exhaustion (238 slots ≈ 95s out of ~150s validity window), and (2) tip far below market floor (1303 lamports vs. p99 of 629,464).\n\n**Root Causes:**\n1. **Blockhash stale/expired**: slotsSinceBlockhashFetch = 238 slots is CRITICAL — it exceeds the ~150 slot validity window. Any resubmission without a fresh blockhash will be rejected deterministically.\n2. **Tip catastrophically low**: 1303 lamports is 0.2% of p99. Even accounting for published percentiles being from authenticated/staked connections, a tip this low on a public connection would be dropped before auction immediately. The gap to p99 (629k) is ~480×. The bundle was likely dropped in the mempool before even reaching the auction.\n\n**Why This Happened:**\n- Ultra-low tip (1303) → immediate rejection from public mempool during congestion (factor 0.8).\n- Stale blockhash (238 slots) → if it somehow reached validation, it would fail as expired.\n\n**Strategy (Aggressive Escalation):**\nThe tip was not just low, it was orders of magnitude below market. The only proven remedy is multiplicative escalation. I am NOT crawling from 1303 up — that is wasted attempts. Instead:\n\n- **Refresh blockhash**: Mandatory. 238 slots is beyond safety. A fresh blockhash costs nothing and eliminates a guaranteed failure vector.\n- **Escalate tip multiplicatively**: Jump directly to **3,200,000 lamports** (~3.2M), which is **80% of maxTipLamports (4M)** and ~5× the p99. This is aggressive enough to clear the inclusion floor on a public connection, assuming the bundle's other parameters are sound.\n- **Delay 2 slots**: Brief wait allows the network to digest the previous dropped attempt and gives a marginally better leader window probability. Jito leader windows rotate frequently; a 2-slot delay is cheap insurance.\n\n**Confidence: 0.72**\nHigh confidence the blockhash refresh alone fixes one major cause. The 80% tip tip should clear typical public-connection inclusion floors. However, if the bundle itself has a structural issue (e.g., invalid instructions, bad signatures), even this high tip will not save it, reducing confidence to ~0.72 rather than 0.85.\n\n**Cost/Benefit:**\n- **Cost**: ~3.2M lamports on this attempt. Failed attempt costs nothing, so the marginal cost of escalation vs. a timid bump is tiny.\n- **Benefit**: High probability of landing if the bundle is structurally sound.\n- **Remaining runway**: 5 more attempts (attempt 1 of 6) with room to escalate further if needed.\n\n**Rejected Alternatives:**\n\n1. **Abort immediately** — WRONG. We have only tried once, at a tip far below market, with an expired blockhash. This is not a conclusive signal of structural unsuitability; it is a signal of underpricing and staleness. Aborting here would give up prematurely. We abort only after attempting at or near maxTipLamports and still failing.\n\n2. **Retry with same tip + fresh blockhash only** — Insufficient. While refreshing the blockhash is necessary, the tip of 1303 is still catastrophically low. A bundle that was dropped at 1303 lamports will be dropped again at 1303 lamports, regardless of blockhash freshness. This would waste an attempt.\n\n3. **Increment tip modestly (e.g., to 1500 or 2000 lamports)** — FALSE ECONOMY. When a bundle is dropped at 1303 (far below p25 of 1000, likely rejected before auction), small bumps do nothing. The inclusion floor on this connection is likely 50k–200k+. Crawling up with timid steps burns attempts. One aggressive jump is cheaper.\n\n4. **Delay 0 slots (resubmit immediately)** — Slightly suboptimal. A 2-slot delay adds ~0.8s and costs nothing operationally. It marginally improves leader diversity and gives the network brief breathing room. Worth the negligible latency cost.\n\n5. **Set tip to 4M (100% of max)** — Reasonable alternative, but 3.2M (80%) is sufficient to test clearance of the true inclusion floor without maxing the budget on the first real attempt. If 3.2M fails, we escalate to 4M.\n",
  "decision": {
    "action": "retry",
    "changes": {
      "refreshBlockhash": true,
      "newTipLamports": 3200000,
      "delaySlots": 2
    },
    "confidence": 0.72,
    "rejectedAlternatives": [
      "Abort immediately — only 1 attempt made at ultra-low tip with expired blockhash; this is underpricing + staleness, not structural unsuitability. Abort only after maxTipLamports attempt fails.",
      "Retry with same tip + fresh blockhash only — tip of 1303 is orders of magnitude below market floor; refreshing blockhash alone will not fix rejection. Tip escalation is mandatory.",
      "Increment tip modestly (to 1500–2000) — dropped-before-auction bundles need multiplicative jumps, not percentage bumps. Small increases waste attempts. Jump to 80% of max instead.",
      "Resubmit immediately (0 slot delay) — marginally suboptimal. A 2-slot delay costs negligible latency and improves leader diversity; take it.",
      "Set tip to 4M (100% of maxTipLamports) — 3.2M (80%) is sufficient to test the real inclusion floor. If it fails, we escalate to 4M on the next attempt. Conservative escalation avoids over-tipping on the first retry."
    ]
  },
  "model": "claude-haiku-4-5-20251001"
}
```
