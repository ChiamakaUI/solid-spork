import { type DashState } from "@/lib/store";
import { Panel } from "./ui";
import { ago, lamportsToSol } from "@/lib/format";

export function RecoveryPanel({ s, now }: { s: DashState; now: number }) {
  const r = s.recovery;
  return (
    <Panel
      title="Recovery Panel"
      right={<span className="text-[9px] text-dim">monitor</span>}
      bodyClass="p-0"
    >
      {!r ? (
        <div className="px-3 py-3 text-dim text-[11px]">no active recovery — bundles nominal</div>
      ) : (
        <div>
          <div className="px-3 py-1.5 bg-red/15 border-b border-red/30 text-[11px] text-red flex justify-between">
            <span>
              Bundle B{r.index}·a{r.attempt} failed
            </span>
            <span className="text-dim">{ago(r.at, now)}</span>
          </div>
          <div className="px-3 py-2.5 text-[11px] space-y-1.5">
            <div className="text-dim">
              class: <span className="text-amber">{r.failureClass}</span>
            </div>
            {r.action === "retry" ? (
              <div className="text-fg">
                Retrying with escalated tip
                {r.nextTip != null ? ` → ${lamportsToSol(r.nextTip)} SOL` : ""}…
              </div>
            ) : r.action === "abort" ? (
              <div className="text-red">Aborted — connection needs authenticated infra</div>
            ) : (
              <div className="text-dim blink">Agent analyzing failure…</div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[9px] text-dim">Attempt</span>
              <span className="text-fg tabular-nums">
                {r.attempt}/{s.campaign?.maxAttempts ?? 6}
              </span>
              {r.nextTip != null && (
                <span className="ml-auto text-amber tabular-nums">
                  {lamportsToSol(r.nextTip)} SOL
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
