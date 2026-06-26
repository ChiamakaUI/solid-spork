/**
 * Architecture document — rendered in-app as the "Architecture" tab so the
 * single Vercel deploy is BOTH the live ops console and the required public
 * architecture document (Superteam deliverable #1). Self-contained: no live
 * data, safe to render in replay or hosted read-only mode.
 */
import { type ReactNode } from "react";

function Section({
  n,
  title,
  sub,
  children,
}: {
  n: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="flex items-baseline gap-3 px-4 py-2.5 border-b border-line">
        <span className="text-cyan text-[11px] font-bold tracking-[0.2em]">{n}</span>
        <span className="text-fg text-[13px] font-semibold tracking-wide">{title}</span>
        {sub && <span className="text-dim text-[10px] ml-auto hidden md:inline">{sub}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Card({
  title,
  accent = "text-cyan",
  children,
}: {
  title: string;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-line rounded bg-panel2 p-3">
      <div className={`text-[11px] font-semibold tracking-wide mb-1.5 ${accent}`}>{title}</div>
      <div className="text-[12px] text-fg/85 leading-relaxed">{children}</div>
    </div>
  );
}

/* ── Data-flow diagram ───────────────────────────────────────────────── */

const C = {
  obs: "#aef03a", // observe / ingest
  act: "#7fb800", // act
  ok: "#3fd17e", // landed
  ai: "#9a8cff", // agent
  warn: "#f0a73a",
  red: "#ef5b6b",
  line: "#22323e",
  dim: "#5d7282",
  fg: "#cdd9e3",
  panel: "#0f1710",
};

function Node({
  x,
  y,
  w,
  h,
  label,
  sub,
  stroke,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  stroke: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={C.panel} stroke={stroke} strokeWidth={1.3} />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 4 : y + h / 2 + 4}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={C.fg}
      >
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={9} fill={C.dim}>
          {sub}
        </text>
      )}
    </g>
  );
}

function EdgeLabel({ x, y, fill, children }: { x: number; y: number; fill: string; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={fill}>
      {children}
    </text>
  );
}

function FlowDiagram() {
  return (
    <svg viewBox="0 0 960 560" className="w-full" style={{ maxHeight: 600 }}>
      <defs>
        <marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.dim} />
        </marker>
        <marker id="arrAi" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.ai} />
        </marker>
        <marker id="arrOk" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.ok} />
        </marker>
        <marker id="arrRed" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.red} />
        </marker>
        <marker id="arrWarn" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={C.warn} />
        </marker>
      </defs>

      {/* lane tints + labels */}
      <rect x={20} y={44} width={290} height={490} rx={8} fill={C.obs} opacity={0.03} />
      <rect x={358} y={44} width={244} height={490} rx={8} fill={C.act} opacity={0.04} />
      <rect x={648} y={44} width={292} height={490} rx={8} fill={C.ai} opacity={0.04} />
      <text x={165} y={32} textAnchor="middle" fontSize={10} letterSpacing={3} fill={C.obs}>
        OBSERVE
      </text>
      <text x={480} y={32} textAnchor="middle" fontSize={10} letterSpacing={3} fill={C.act}>
        ACT
      </text>
      <text x={794} y={32} textAnchor="middle" fontSize={10} letterSpacing={3} fill={C.ai}>
        REASON · RECOVER
      </text>

      {/* OBSERVE lane */}
      <Node x={40} y={70} w={210} h={46} label="Yellowstone gRPC" sub="SolInfra AMS · slots-only stream" stroke={C.obs} />
      <Node x={40} y={160} w={210} h={46} label="Slot / Leader feed" sub="congestion · next Jito leader" stroke={C.obs} />
      <Node x={40} y={250} w={210} h={46} label="Tip Engine" sub="ema50 × congestion × urgency" stroke={C.obs} />
      <Node x={40} y={340} w={210} h={46} label="Fault Injector" sub="test harness · expires tx on-chain" stroke={C.warn} />

      {/* ACT lane (central submission pipeline) */}
      <Node x={375} y={70} w={210} h={50} label="Orchestrator" sub="holds NO retry policy" stroke={C.act} />
      <Node x={375} y={165} w={210} h={46} label="Bundle Builder" sub="payload + tip in one tx" stroke={C.act} />
      <Node x={375} y={255} w={210} h={46} label="Block Engine (Jito)" sub="AMS · gated 1 req / 1.5s" stroke={C.act} />
      <Node x={375} y={345} w={210} h={44} label="Solana mainnet" sub="auction → block" stroke={C.dim} />
      <Node x={375} y={435} w={210} h={46} label="Landing Poller" sub="getSignatureStatuses" stroke={C.act} />

      {/* REASON · RECOVER lane (bottom-up: detect → classify → decide) */}
      <Node x={710} y={165} w={205} h={50} label="Claude Agent" sub="haiku-4-5 · decides recovery" stroke={C.ai} />
      <Node x={710} y={280} w={205} h={46} label="Failure Classifier" sub="deterministic, evidence-based" stroke={C.red} />
      <Node x={710} y={435} w={205} h={46} label="Lifecycle Tracker" sub="4-stage ladder + logs" stroke={C.ok} />

      {/* OBSERVE internal: gRPC → derived feeds */}
      <line x1={145} y1={116} x2={145} y2={160} stroke={C.dim} strokeWidth={1.3} markerEnd="url(#arr)" />
      <line x1={145} y1={206} x2={145} y2={250} stroke={C.dim} strokeWidth={1.3} markerEnd="url(#arr)" />

      {/* OBSERVE → ACT */}
      <path d="M250 183 C 320 183, 320 95, 375 95" fill="none" stroke={C.dim} strokeWidth={1.3} markerEnd="url(#arr)" />
      <path d="M250 273 C 320 273, 320 188, 375 188" fill="none" stroke={C.dim} strokeWidth={1.3} markerEnd="url(#arr)" />
      {/* Fault Injector → Block Engine (dashed, test-only) */}
      <path d="M250 363 C 320 363, 320 278, 375 278" fill="none" stroke={C.warn} strokeWidth={1.2} strokeDasharray="4 4" markerEnd="url(#arrWarn)" />

      {/* central pipeline (top → bottom) */}
      <line x1={480} y1={120} x2={480} y2={165} stroke={C.dim} strokeWidth={1.4} markerEnd="url(#arr)" />
      <line x1={480} y1={211} x2={480} y2={255} stroke={C.dim} strokeWidth={1.4} markerEnd="url(#arr)" />
      <line x1={480} y1={301} x2={480} y2={345} stroke={C.dim} strokeWidth={1.4} markerEnd="url(#arr)" />
      <line x1={480} y1={389} x2={480} y2={435} stroke={C.dim} strokeWidth={1.4} markerEnd="url(#arr)" />

      {/* Landing Poller → Lifecycle Tracker (advance) */}
      <line x1={585} y1={458} x2={710} y2={458} stroke={C.ok} strokeWidth={1.4} markerEnd="url(#arrOk)" />
      <EdgeLabel x={647} y={450} fill={C.ok}>advances</EdgeLabel>

      {/* recovery climb: Tracker → Classifier → Agent */}
      <line x1={812} y1={435} x2={812} y2={326} stroke={C.red} strokeWidth={1.4} markerEnd="url(#arrRed)" />
      <EdgeLabel x={812} y={418} fill={C.red}>on failure</EdgeLabel>
      <line x1={812} y1={280} x2={812} y2={215} stroke={C.red} strokeWidth={1.4} markerEnd="url(#arrRed)" />
      <EdgeLabel x={812} y={268} fill={C.red}>classified</EdgeLabel>

      {/* THE closed loop: Agent decision → Orchestrator */}
      <path
        d="M710 180 C 648 150, 648 95, 585 95"
        fill="none"
        stroke={C.ai}
        strokeWidth={1.8}
        strokeDasharray="6 4"
        markerEnd="url(#arrAi)"
      />
      <EdgeLabel x={650} y={132} fill={C.ai}>retry · re-price · abort</EdgeLabel>
    </svg>
  );
}

/* ── Content ─────────────────────────────────────────────────────────── */

const MODULES: { dir: string; role: string; accent: string }[] = [
  { dir: "stream/", role: "Yellowstone gRPC slot + leader feed; single-flight reconnect with exponential backoff & backpressure.", accent: "text-cyan" },
  { dir: "tip/", role: "Dynamic tip engine — clamp(ema50 × congestion × urgency, 1000, maxTip) priced from live tip-floor percentiles. No hardcoded tips.", accent: "text-cyan" },
  { dir: "jito/", role: "Bundle construction, next-Jito-leader targeting, submission, and block-engine status — all behind a client-side rate gate.", accent: "text-teal" },
  { dir: "lifecycle/", role: "Commitment-stage tracker (submitted→processed→confirmed→finalized) + deterministic failure classifier.", accent: "text-green" },
  { dir: "agent/", role: "Claude retry agent: failure context in, decision JSON out (action + changes + reasoning + confidence).", accent: "text-violet" },
  { dir: "fault/", role: "Fault injector — holds a signed tx until its blockhash genuinely expires on-chain, then submits to trigger a real failure.", accent: "text-amber" },
  { dir: "log/", role: "lifecycle.jsonl + agent-decisions.jsonl writers — the explorer-verifiable evidence trail.", accent: "text-dim" },
  { dir: "main.ts", role: "Campaign orchestrator. Contains NO retry policy — it wires signals to the agent and applies the agent's decision.", accent: "text-fg" },
];

const DECISIONS: { d: string; why: string }[] = [
  {
    d: "Yellowstone gRPC (SolInfra AMS) for slot/leader truth, co-located in Amsterdam",
    why: "Slot + leader-schedule streaming drives leader-window targeting and the congestion estimate. Our gRPC provider is SolInfra (Amsterdam) — the same region as the Jito AMS block engine, minimising the observe→act latency that decides auction inclusion.",
  },
  {
    d: "Pin the gRPC client library @triton-one/yellowstone-grpc to v4 (pure @grpc/grpc-js)",
    why: "This is the client library (Triton One's npm package), not the provider — our provider is SolInfra. The v5 NAPI/Rust client's subscribe() hangs or fails to open a stream on Node 24 / darwin-arm64, while grpc-js streams cleanly. v4 is the last pure-JS line — chosen deliberately, not by accident.",
  },
  {
    d: "On-chain landing detection is the source of truth (not block-engine status)",
    why: "On the unauthenticated endpoint the block engine's own status lies — getInflightBundleStatuses reported Invalid for a bundle that finalized on-chain, and the gRPC tx-status notification is dropped by providers. So landing is confirmed by polling getSignatureStatuses from submit until each commitment level is reached. Slot streaming still drives timing; on-chain truth drives the verdict.",
  },
  {
    d: "Client-side rate gate (1 req / 1.5s) in front of every block-engine call",
    why: "Jito's unauthenticated limit is 1 req/s/IP, shared across all methods, and the penalty is a silent shadow-drop (valid bundle_id, never enters the auction). One global token gate makes it impossible for a campaign to penalise its own IP.",
  },
  {
    d: "Tip + payload in the same transaction",
    why: "In uncle/skipped-slot scenarios Jito can rebroadcast bundle txs individually through the normal banking stage where atomicity doesn't apply. Keeping the tip transfer in the payload tx guarantees a partial landing can never pay a tip for work that didn't execute.",
  },
  {
    d: "Haiku-4-5 agent, strict separation from the transaction layer",
    why: "The agent receives structured failure context and returns a decision; it never touches RPC or signing. The decision is tightly bounded by the SYSTEM_PROMPT and a structured-output schema, so Haiku — the cheapest capable model — is the default; it follows the escalation policy reliably and the agent fires only on failures, a handful of calls per campaign. Sonnet-4-6 is a one-line config swap for richer free-form reasoning.",
  },
];

const CLASSES: { cls: string; evidence: string; agent: string }[] = [
  { cls: "expired_blockhash", evidence: "isBlockhashValid=false at detection; slotsSinceFetch > 150", agent: "refresh blockhash, re-price, resubmit" },
  { cls: "fee_too_low", evidence: "no inclusion while auction percentiles rose above tip", agent: "escalate tip toward p99, resubmit" },
  { cls: "compute_exceeded", evidence: "stream tx error: compute budget", agent: "abort (payload-level, not retryable by re-pricing)" },
  { cls: "bundle_failure", evidence: "block engine Invalid + on-chain absence", agent: "re-price / re-target next leader, or abort" },
  { cls: "unknown", evidence: "no decisive signal", agent: "conservative resubmit with refreshed blockhash" },
];

export function ArchitectureView() {
  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* Hero */}
      <div className="panel px-5 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-cyan font-bold tracking-[0.25em] text-base">SLIPSTREAM</span>
          <span className="text-dim text-[11px]">architecture document</span>
        </div>
        <p className="text-fg/85 text-[12.5px] leading-relaxed mt-2 max-w-4xl">
          A smart Solana transaction stack: observe the network in real time over Yellowstone gRPC,
          submit Jito bundles with dynamically-priced tips, track each transaction across all four
          commitment levels, and let a Claude agent own the single operational decision that matters —
          how to recover from a failure. The orchestrator holds <b className="text-fg">no retry policy</b>;
          every retry, re-price, and abort is the agent's call, logged as structured JSON.
        </p>
        <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
          {["Jito bundles", "Yellowstone gRPC", "dynamic tips", "4-stage lifecycle", "deterministic classifier", "Claude agent", "fault injection"].map(
            (t) => (
              <span key={t} className="px-2 py-0.5 rounded border border-line text-dim">
                {t}
              </span>
            )
          )}
        </div>
      </div>

      <Section n="01" title="Data flow between services" sub="observe → act → reason, with an agent feedback loop">
        <FlowDiagram />
        <p className="text-dim text-[11px] leading-relaxed mt-2">
          The slot/leader stream and the tip engine feed the orchestrator, which builds a bundle and
          submits it through the rate-gated block engine. The landing poller establishes on-chain
          truth and advances the lifecycle tracker. On a failure (organic or fault-injected), the
          classifier turns raw evidence into a class and the agent decides what changes before the
          orchestrator resubmits — a closed loop, no hardcoded retry path.
        </p>
      </Section>

      <Section n="02" title="Components" sub="src/ — clean separation between the AI and transaction layers">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {MODULES.map((m) => (
            <Card key={m.dir} title={m.dir} accent={m.accent}>
              {m.role}
            </Card>
          ))}
        </div>
      </Section>

      <Section n="03" title="Infrastructure decisions" sub="every choice earned the hard way">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {DECISIONS.map((x) => (
            <div key={x.d} className="border border-line rounded bg-panel2 p-3">
              <div className="text-[12px] text-cyan font-semibold mb-1">{x.d}</div>
              <div className="text-[11.5px] text-fg/80 leading-relaxed">{x.why}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section n="04" title="Failure handling" sub="failures are first-class; happy-path is not the point">
        <p className="text-fg/80 text-[12px] leading-relaxed mb-3">
          A deterministic classifier maps raw evidence (stream tx errors, block-engine inflight
          status, isBlockhashValid at detection) onto a failure class. The class plus live context
          goes to the agent — never to a hardcoded branch. The campaign also injects real faults: the
          injector holds a fully-signed transaction until its blockhash expires on-chain, then submits
          it, so the failure → detection → classification → recovery chain that follows is genuine.
        </p>
        <div className="border border-line rounded overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-panel2 text-dim text-[10px] tracking-wider uppercase">
                <th className="text-left px-3 py-2 font-medium">Class</th>
                <th className="text-left px-3 py-2 font-medium">Evidence</th>
                <th className="text-left px-3 py-2 font-medium">Typical agent decision</th>
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((c) => (
                <tr key={c.cls} className="border-t border-line">
                  <td className="px-3 py-2 text-red font-mono whitespace-nowrap">{c.cls}</td>
                  <td className="px-3 py-2 text-fg/75">{c.evidence}</td>
                  <td className="px-3 py-2 text-fg/75">{c.agent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n="05" title="AI agent responsibilities" sub="one real decision, made with visible reasoning">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Card title="The agent OWNS" accent="text-violet">
            <ul className="list-disc pl-4 space-y-1">
              <li>Reading the classified failure + live auction percentiles, leader schedule, and blockhash age.</li>
              <li>Choosing the action: refresh blockhash, re-price the tip, delay N slots, or abort.</li>
              <li>Escalating the tip toward the inclusion floor when the auction is the bottleneck.</li>
              <li>Emitting reasoning, confidence, and rejected alternatives as structured JSON.</li>
            </ul>
          </Card>
          <Card title="The agent NEVER" accent="text-dim">
            <ul className="list-disc pl-4 space-y-1">
              <li>Touches RPC, signing, or bundle submission — that stays in the transaction layer.</li>
              <li>Follows a hardcoded retry sequence — there isn't one to follow.</li>
              <li>Sees secrets or the keypair; it receives sanitized context only.</li>
              <li>Runs on the happy path — it fires only when a failure is classified.</li>
            </ul>
          </Card>
        </div>
        <p className="text-dim text-[11px] leading-relaxed mt-3">
          This is the <b className="text-fg/80">Autonomous Retry with Fault Injection</b> demonstration:
          the stack simulates blockhash expiry, the agent detects it, reasons about the cause, refreshes
          the blockhash, recalculates the tip, and resubmits — every decision visible in the Decisions tab
          and in <span className="font-mono">agent-decisions.jsonl</span>.
        </p>
      </Section>

      <Section n="06" title="Lifecycle & verification" sub="explorer-verifiable evidence">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Card title="Four-stage ladder" accent="text-green">
            Every attempt records the wall-clock time it first reaches{" "}
            <span className="font-mono text-fg">submitted → processed → confirmed → finalized</span>, with
            slot numbers and latency deltas. processed→confirmed is the consensus-speed signal (Q1);
            confirmed→finalized is the ~32-slot commitment lag (Q2).
          </Card>
          <Card title="Cross-referenceable" accent="text-cyan">
            Each landed entry in <span className="font-mono text-fg">lifecycle.jsonl</span> carries its
            signature, blockhash fetch slot, tip basis (formula inputs), target leader, and the agent
            decisions that drove each retry — every slot and signature checkable on any Solana explorer.
          </Card>
        </div>
      </Section>
    </div>
  );
}
