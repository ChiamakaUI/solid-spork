import { type DashState } from "@/lib/store";
import { type DecisionEv } from "@/lib/events";
import { Panel } from "./ui";
import { ago, lamportsToSol } from "@/lib/format";

function summarize(d: DecisionEv): string {
  if (d.decision.action === "abort") return "Abort retries";
  const c = d.decision.changes ?? {};
  const parts: string[] = [];
  if (c.newTipLamports != null) parts.push(`Tip → ${lamportsToSol(c.newTipLamports)} SOL`);
  if (c.refreshBlockhash) parts.push("Refresh blockhash");
  if (c.delaySlots) parts.push(`Delay ${c.delaySlots} slots`);
  return parts.length ? parts.join(" · ") : "Retry";
}

function firstSentence(reasoning: string): string {
  const cleaned = reasoning.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim();
  const cut = cleaned.split(/(?<=\.)\s|:\s|—/)[0] ?? cleaned;
  return cut.length > 150 ? cut.slice(0, 147) + "…" : cut;
}

export function AIDecisions({
  s,
  now,
  className,
}: {
  s: DashState;
  now: number;
  className?: string;
}) {
  return (
    <Panel
      title="AI Decisions"
      className={className}
      right={
        <span className="text-[9px] text-violet">
          {s.campaign?.agentModel ?? "agent"}
        </span>
      }
      bodyClass="overflow-auto px-3 py-2 space-y-2"
    >
      {s.decisions.length === 0 ? (
        <div className="text-dim text-[11px]">no decisions yet — agent fires on failures</div>
      ) : (
        s.decisions.map((d) => {
          const abort = d.decision.action === "abort";
          return (
            <div
              key={d.id}
              className="border border-line rounded bg-panel2 px-2.5 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`font-medium ${abort ? "text-red" : "text-violet"}`}>
                  {summarize(d)}
                </span>
                <span className="text-[9px] text-dim shrink-0">{ago(d.at, now)}</span>
              </div>
              <div className="text-dim mt-1 leading-snug">
                Reason: {firstSentence(d.reasoning)}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[9px] text-dim">Confidence</span>
                <div className="flex-1 h-1 bg-line2 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${abort ? "bg-red" : "bg-violet"}`}
                    style={{ width: `${Math.round(d.decision.confidence * 100)}%` }}
                  />
                </div>
                <span className={`text-[9px] ${abort ? "text-red" : "text-violet"}`}>
                  {Math.round(d.decision.confidence * 100)}%
                </span>
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}
