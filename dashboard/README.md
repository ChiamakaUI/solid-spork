# Slipstream Dashboard

A live ops dashboard for the Slipstream smart-transaction stack — the AEGIS-style
view of Jito bundle lifecycle, the dynamic tip engine, leader-window targeting,
and the AI retry agent's reasoning, all over Yellowstone gRPC on Solana mainnet.

Next.js (App Router) + Tailwind. No backend of its own — it consumes the
orchestrator's event stream.

## Two modes (same UI)

| Mode | When | Data source |
|---|---|---|
| **Live** | running locally beside a campaign | SSE from the orchestrator's `DashboardServer` (default `http://localhost:8088/events`) |
| **Replay** | hosted (Vercel) or no campaign running | the committed `public/data/*.jsonl` campaign logs, animated |

On load it tries the live SSE endpoint; if nothing answers in ~2.6s it falls
back to replay. Force either with `?live` or `?replay`.

## Run it

**Replay (what judges see):**
```bash
npm install
npm run dev          # http://localhost:3000  → replays public/data/*.jsonl
```

**Live, beside a running campaign:**
```bash
# terminal 1 — in the repo root (../)
npm run run:campaign            # starts the orchestrator + its SSE server on :8088

# terminal 2 — here
npm run dev                     # the dashboard auto-connects to the live stream
```

## Keep the replay dataset real

The replay reads `public/data/lifecycle.jsonl` + `public/data/agent-decisions.jsonl`.
After any campaign, refresh them from the real logs with one command (run in `../`):
```bash
npm run dashboard:data          # cp logs/*.jsonl -> dashboard/public/data/
```
Every number shown is real and on-chain — landed signatures link to the explorer.

## Deploy (Vercel)

Set the project **root directory** to `dashboard/`. No env vars required (it falls
back to replay when there's no local campaign). Optionally set
`NEXT_PUBLIC_LIVE_URL` to point live mode at a reachable SSE host.

```
Framework preset: Next.js
Root directory:   dashboard
Build command:    next build   (default)
```
