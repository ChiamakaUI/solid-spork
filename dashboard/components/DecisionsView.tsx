import { type DashState } from "@/lib/store";
import { type DecisionEv } from "@/lib/events";
import { Panel } from "./ui";
import { ago, lamportsToSol } from "@/lib/format";

function changes(d: DecisionEv): string[] {
  const c = d.decision.changes ?? {};
  const parts: string[] = [];
  if (c.newTipLamports != null) parts.push(`tip → ${lamportsToSol(c.newTipLamports)} SOL`);
  if (c.refreshBlockhash) parts.push("refresh blockhash");
  if (c.delaySlots) parts.push(`delay ${c.delaySlots} slots`);
  if (c.otherAdjustments) parts.push(c.otherAdjustments);
  return parts;
}

export function DecisionsView({ s, now }: { s: DashState; now: number }) {
  return (
    <Panel
      title={`AI Decision Log · ${s.decisions.length}`}
      right={<span className="text-[10px] text-violet">{s.campaign?.agentModel ?? "agent"}</span>}
      bodyClass="overflow-auto p-3"
    >
      {s.decisions.length === 0 ? (
        <div className="text-dim text-[12px]">no decisions yet — the agent fires only on failures</div>
      ) : (
        <div className="space-y-2">
          {s.decisions.map((d) => {
            const abort = d.decision.action === "abort";
            const ch = changes(d);
            return (
              <div key={d.id} className="border border-line rounded bg-panel2 px-3 py-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-[1px] text-[9px] tracking-[0.12em] uppercase rounded border ${
                      abort ? "bg-red/10 text-red border-red/30" : "bg-cyan/10 text-cyan border-cyan/30"
                    }`}
                  >
                    {d.decision.action}
                  </span>
                  <span className="text-dim text-[10px]">
                    bundle #{d.index} · attempt {d.trigger?.attempt ?? "—"} · {d.trigger?.failureClass ?? "—"}
                  </span>
                  <span className="ml-auto text-[10px] text-dim shrink-0">{ago(d.at, now)}</span>
                </div>

                {ch.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ch.map((c, i) => (
                      <span key={i} className="text-[10px] text-fg bg-line/60 rounded px-1.5 py-[1px]">
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                <div className="text-dim mt-2 leading-relaxed whitespace-pre-wrap">
                  {d.reasoning.replace(/[#*`]/g, "").trim()}
                </div>

                {d.decision.rejectedAlternatives?.length > 0 && (
                  <div className="mt-2 text-[10px] text-dim">
                    <span className="text-dim/70">rejected: </span>
                    {d.decision.rejectedAlternatives.join(" · ")}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[9px] text-dim">Confidence</span>
                  <div className="w-40 h-1 bg-line2 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${abort ? "bg-red" : "bg-cyan"}`}
                      style={{ width: `${Math.round(d.decision.confidence * 100)}%` }}
                    />
                  </div>
                  <span className={`text-[9px] ${abort ? "text-red" : "text-cyan"}`}>
                    {Math.round(d.decision.confidence * 100)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
