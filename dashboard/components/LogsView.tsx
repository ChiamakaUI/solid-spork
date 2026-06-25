import { type DashState } from "@/lib/store";
import { Panel } from "./ui";
import { ago, lamportsToSol, shortSig } from "@/lib/format";

interface LogLine {
  at: number;
  tag: string;
  color: string;
  idx?: number;
  sig?: string;
  msg: string;
}

/** Flatten the reduced store state back into a chronological event stream. */
function buildLines(s: DashState): LogLine[] {
  const lines: LogLine[] = [];

  if (s.campaign) {
    lines.push({
      at: s.campaign.startedAt,
      tag: "CAMPAIGN",
      color: "text-cyan",
      msg: `start · ${s.campaign.totalBundles} bundles · ${s.campaign.network} · agent ${s.campaign.agentModel}`,
    });
  }

  for (const r of s.rows) {
    const st = r.stageTimes;
    if (st.submitted != null)
      lines.push({
        at: st.submitted,
        tag: "SUBMIT",
        color: "text-cyan",
        idx: r.index,
        sig: r.signature,
        msg: `tip ${r.tipLamports.toLocaleString()} lpt${r.bundleId ? ` · bundle ${shortSig(r.bundleId, 6, 4)}` : ""}`,
      });
    if (st.processed != null)
      lines.push({
        at: st.processed,
        tag: "PROCESSED",
        color: "text-amber",
        idx: r.index,
        sig: r.signature,
        msg: `slot ${r.stageSlots.processed?.toLocaleString() ?? "?"}`,
      });
    if (st.confirmed != null)
      lines.push({ at: st.confirmed, tag: "CONFIRMED", color: "text-green", idx: r.index, sig: r.signature, msg: "supermajority voted" });
    if (st.finalized != null)
      lines.push({
        at: st.finalized,
        tag: "FINALIZED",
        color: "text-green",
        idx: r.index,
        sig: r.signature,
        msg: `slot ${r.stageSlots.finalized?.toLocaleString() ?? r.stageSlots.processed?.toLocaleString() ?? "?"}`,
      });
    if (r.status === "dropped" && r.failureClass) {
      const at = st.processed ?? st.submitted ?? r.submittedAt;
      lines.push({
        at,
        tag: "FAILURE",
        color: "text-red",
        idx: r.index,
        sig: r.signature,
        msg: `${r.failureClass}${r.failureDetail ? ` — ${r.failureDetail.slice(0, 100)}` : ""}`,
      });
    }
  }

  for (const d of s.decisions) {
    const c = d.decision.changes ?? {};
    const detail =
      d.decision.action === "abort"
        ? "abort retries"
        : [
            c.newTipLamports != null ? `tip → ${lamportsToSol(c.newTipLamports)} SOL` : null,
            c.refreshBlockhash ? "refresh blockhash" : null,
            c.delaySlots ? `delay ${c.delaySlots} slots` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "retry";
    lines.push({
      at: d.at,
      tag: "AGENT",
      color: "text-violet",
      idx: d.index,
      msg: `${detail} · ${Math.round(d.decision.confidence * 100)}% conf`,
    });
  }

  return lines.sort((a, b) => b.at - a.at);
}

export function LogsView({ s, now }: { s: DashState; now: number }) {
  const lines = buildLines(s);
  return (
    <Panel
      title={`Event Log · ${lines.length}`}
      right={<span className="text-[10px] text-dim">{s.mode.toUpperCase()}</span>}
      bodyClass="overflow-auto p-3 font-mono"
    >
      {lines.length === 0 ? (
        <div className="text-dim text-[12px]">no events yet…</div>
      ) : (
        <div className="space-y-0.5 text-[11px]">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 items-baseline hover:bg-line/30 rounded px-1 -mx-1">
              <span className="text-dim tabular-nums w-12 shrink-0 text-right">{ago(l.at, now)}</span>
              <span className={`w-[72px] shrink-0 ${l.color}`}>{l.tag}</span>
              <span className="text-dim w-10 shrink-0 tabular-nums">{l.idx != null ? `#${l.idx}` : ""}</span>
              <span className="text-cyan/70 w-24 shrink-0 hidden md:inline">
                {l.sig ? shortSig(l.sig, 5, 4) : ""}
              </span>
              <span className="text-fg/90 min-w-0 break-all">{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
