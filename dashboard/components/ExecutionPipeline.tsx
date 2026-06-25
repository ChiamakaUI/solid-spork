import { type OrchRow } from "@/lib/events";
import { Panel } from "./ui";
import { ms, shortSig } from "@/lib/format";

const STAGES: { key: keyof OrchRow["stageTimes"] | "created"; label: string }[] = [
  { key: "created", label: "CREATED" },
  { key: "submitted", label: "SUBMITTED" },
  { key: "processed", label: "PROCESSED" },
  { key: "confirmed", label: "CONFIRMED" },
  { key: "finalized", label: "FINALIZED" },
];

export function ExecutionPipeline({ row }: { row?: OrchRow }) {
  const t = (k: string): number | undefined =>
    k === "created" ? row?.submittedAt : (row?.stageTimes as any)?.[k];

  const reachedIdx = row
    ? STAGES.reduce((acc, st, i) => (t(st.key as string) != null ? i : acc), 0)
    : -1;
  const dropped = row?.status === "dropped" || row?.status === "aborted";

  return (
    <Panel
      title="Execution Pipeline"
      right={
        <span className="text-[10px] text-dim">
          {row ? `ID: B${row.index}·a${row.attempt}` : "ID: —"}
        </span>
      }
      bodyClass="px-5 py-5"
    >
      {!row ? (
        <div className="text-dim text-[12px]">no active bundle</div>
      ) : (
        <div className="flex items-start justify-between">
          {STAGES.map((st, i) => {
            const ts = t(st.key as string);
            const done = ts != null;
            const isReached = i <= reachedIdx;
            const prevTs = i > 0 ? t(STAGES[i - 1].key as string) : undefined;
            const delta = ts != null && prevTs != null ? ts - prevTs : undefined;
            const failedHere = dropped && i === reachedIdx + 1;
            return (
              <div key={st.label} className="flex-1 flex flex-col items-center relative">
                {i > 0 && (
                  <div className="absolute -left-1/2 top-[7px] w-full flex items-center justify-center">
                    <div
                      className={`h-[2px] w-[80%] ${
                        isReached ? "bg-cyan/60" : "bg-line2"
                      }`}
                    />
                    {delta != null && (
                      <span className="absolute -top-4 text-[9px] text-dim">+{ms(delta)}</span>
                    )}
                  </div>
                )}
                <div
                  className={`w-4 h-4 rounded-sm border-2 z-10 ${
                    done
                      ? "bg-cyan border-cyan shadow-glow"
                      : failedHere
                        ? "bg-red border-red"
                        : i === reachedIdx + 1 && !dropped
                          ? "border-cyan/60 bg-transparent blink"
                          : "border-line2 bg-transparent"
                  }`}
                />
                <span
                  className={`mt-2 text-[10px] tracking-wider ${
                    done ? "text-cyan" : failedHere ? "text-red" : "text-dim"
                  }`}
                >
                  {failedHere ? "DROPPED" : st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {row && (
        <div className="mt-4 pt-3 border-t border-line flex items-center gap-4 text-[10px] text-dim">
          <span>
            sig <span className="text-fg">{shortSig(row.signature)}</span>
          </span>
          <span>
            tip <span className="text-fg">{row.tipLamports.toLocaleString()} lpt</span>
          </span>
          {row.targetLeaderSlot && (
            <span>
              target leader <span className="text-fg">{row.targetLeaderSlot.toLocaleString()}</span>
            </span>
          )}
          {row.faultInjected && <span className="text-amber">fault-injected</span>}
        </div>
      )}
    </Panel>
  );
}
