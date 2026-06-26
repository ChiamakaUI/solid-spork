# Slipstream — Submission Map

This document maps every requirement of the **Advanced Infrastructure Challenge – Build a Smart
Transaction Stack** to exactly where it is satisfied in this repository, so the judging is fast and
nothing is missed. Deeper prose lives in [`README.md`](./README.md); the live system and the
architecture document are the deployed dashboard.

- **Live ops console + architecture document:** `<TODO: Vercel URL>` (dashboard → **Architecture** tab)
- **Source:** this repo · **Network:** mainnet-beta · **Agent:** Claude Haiku 4.5

---

## Requirements

### 1 · Architecture Design Document
A public document covering architecture, data flow, infrastructure decisions, failure-handling
strategy, and AI-agent responsibilities, with diagrams.

→ **Dashboard → Architecture tab** (`dashboard/components/ArchitectureView.tsx`): an inline
data-flow diagram (OBSERVE → ACT → REASON with the agent feedback loop), component map,
infrastructure-decision cards, the failure-classifier table, and the agent's OWNS/NEVER
responsibilities. Ships in the same deploy as the live console — one public URL.

### 2 · The Transaction Stack
| Sub-requirement | Where |
|---|---|
| Monitor live slot + leader data via Yellowstone gRPC | `src/stream/geyser.ts` (slots-only stream, single-flight reconnect + backoff) |
| Detect correct leader window for submission | `src/jito/` `nextScheduledLeader` + `main.ts` leader-window targeting |
| Construct & submit Jito bundles | `src/jito/` (payload + tip in one tx) |
| Dynamic tips from real tip-account data (no hardcoding) | `src/tip/` — `clamp(ema50 × congestion × urgency, 1000, maxTip)`, inputs logged per attempt |
| Lifecycle: Submitted → Processed → Confirmed → Finalized | `src/lifecycle/` + `pollLanding()` in `main.ts` |
| Timestamps, slot numbers, latency deltas | `logs/lifecycle.jsonl` (per-stage `observedAt`, `slot`, `deltaFromPrevMs`) |
| Classify failures (expired blockhash, low fee, compute, bundle failure) | `src/lifecycle/` deterministic classifier |
| Confirm landing without trusting `sendBundle` | on-chain `getSignatureStatuses` — see README *Operational lessons #3* for why the stream notification is insufficient on this provider |
| Automatic retries with blockhash refresh on expiry | agent decision → `main.ts` applies refresh + re-price + resubmit |

### 3 · Lifecycle Log (≥10 real submissions, ≥2 failures)
→ `logs/lifecycle.jsonl` — one entry per logical transaction, every attempt with signature,
blockhash fetch slot, tip basis, target leader, stage timestamps, and failure classification.
The campaign injects **real** faults (`src/fault/` holds a signed tx until its blockhash expires
on-chain), so the log carries genuine classified failures and their autonomous recoveries. Every
landed slot + signature is checkable on any explorer. Regenerate the human summary with
`npm run report` → `logs/report.md`.

### 4 · AI Agent — one real operational decision
→ **Autonomous Retry with Fault Injection** (+ failure reasoning + tip intelligence). `src/agent/`
receives classified failure context and returns a decision JSON (`action`, `changes`, `reasoning`,
`confidence`, rejected alternatives). The orchestrator (`main.ts`) holds **no retry policy** — it
applies whatever the agent decides. Every decision is in `logs/agent-decisions.jsonl` and the
dashboard **Decisions** tab. Not a sequential wrapper: the retry path does not exist outside the
agent's output.

### 5 · README Questions
→ [`README.md`](./README.md) → *The three required questions*: processed→confirmed as a
network-health signal (Q1), why never fetch a blockhash at `finalized` (Q2), and what happens when
a Jito leader skips its slot (Q3) — each backed by real logged observations.

### 6 · General
Open-source with setup instructions (README *Quick start*), working mainnet prototype, reconnection
handling (`src/stream/geyser.ts` single-flight exponential backoff), real Jito bundle construction,
dynamic tips, correct commitment levels, and a clean separation between the AI layer (`src/agent/`)
and the transaction layer (everything else — the agent never touches RPC or signing). Failure
handling is first-class; the happy path is not the point.

---

## Evaluation criteria → evidence
| Criterion | Evidence |
|---|---|
| **Does it work?** | `logs/report.md` (landing rate, explorer-verifiable signatures) + the live dashboard |
| **Depth of integration** | real Jito block-engine + Yellowstone gRPC, no hardcoded tips, correct commitment ladder, on-chain truth over a lying block-engine status (README *Operational lessons*) |
| **AI demonstration** | `logs/agent-decisions.jsonl` + Decisions tab — visible reasoning, confidence, rejected alternatives, real fault→recovery arcs |
| **Explanation** | Architecture tab + README depth + the operational lessons learned the hard way |

---

## How to verify (judges)
```bash
npm install
cp .env.example .env          # add your own RPC / gRPC / ANTHROPIC_API_KEY / keypair
npm run smoke                 # exercises all 3 integrations with ZERO SOL
npm run report                # regenerate logs/report.md from the committed logs
```
Open `logs/lifecycle.jsonl`, take any landed entry's `signature` + `slot`, and confirm it on
[solscan.io](https://solscan.io) — same wallet, same builder, real auction.

---

## Pre-submission checklist
- [ ] Judged campaign run (`npm run run:campaign`, ≥10 bundles, 2 faults, Haiku agent) on a fresh `logs/`
- [ ] `npm run report` run → README evidence blocks + `logs/report.md` populated with real numbers
- [ ] Dashboard deployed to a public URL; that URL pasted into `README.md` and `SUBMISSION.md`
- [ ] `logs/lifecycle.jsonl` + `logs/agent-decisions.jsonl` committed (the judged run only)
- [ ] Spot-check 2–3 signatures on an explorer
