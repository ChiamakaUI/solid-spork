import { type OrchRow } from "@/lib/events";
import { Panel, Chip } from "./ui";
import { explorer, lamportsToSol, ms, shortSig } from "@/lib/format";

function Line({
  t0,
  at,
  color,
  children,
}: {
  t0: number;
  at?: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-dim tabular-nums w-12 shrink-0 text-right">
        {at != null ? `+${ms(at - t0)}` : ""}
      </span>
      <span className={`shrink-0 ${color}`}>▸</span>
      <span className="text-fg/90">{children}</span>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-dim text-[9px] uppercase tracking-wide">{k}</span>
      <span className="text-fg/90 tabular-nums">{v}</span>
    </div>
  );
}

export function TracePanel({ row, attempts = [] }: { row?: OrchRow; attempts?: OrchRow[] }) {
  const t0 = row?.submittedAt ?? 0;
  const st = row?.stageTimes ?? {};
  const sl = row?.stageSlots ?? {};
  const procToConf = st.processed != null && st.confirmed != null ? st.confirmed - st.processed : undefined;
  const confToFinal = st.confirmed != null && st.finalized != null ? st.finalized - st.confirmed : undefined;

  return (
    <Panel
      title="Trace"
      right={row && <span className="text-[10px] text-dim">{shortSig(row.signature, 5, 4)}</span>}
      bodyClass="px-3 py-3 overflow-auto"
    >
      {!row ? (
        <div className="text-dim text-[11px]">select a bundle…</div>
      ) : (
        <div className="flex flex-col gap-3 h-full text-[11px]">
          <div className="space-y-1.5">
            <Line t0={t0} at={row.submittedAt} color="text-cyan">
              Bundle assembled (1 tx: memo + tip)
            </Line>
            <Line t0={t0} at={st.submitted} color="text-cyan">
              Submitted to Jito Block Engine
              <span className="block pl-3 text-dim">
                tip: {row.tipLamports.toLocaleString()} lpt
                {row.bundleId ? ` · bundle ${shortSig(row.bundleId, 6, 4)}` : ""}
              </span>
            </Line>
            {st.processed != null && (
              <Line t0={t0} at={st.processed} color="text-amber">
                Processed in slot{" "}
                <span className="text-fg">{sl.processed?.toLocaleString() ?? "?"}</span>
              </Line>
            )}
            {st.confirmed != null && (
              <Line t0={t0} at={st.confirmed} color="text-green">
                Confirmed (supermajority voted)
              </Line>
            )}
            {st.finalized != null && (
              <Line t0={t0} at={st.finalized} color="text-green">
                Finalized · slot{" "}
                <span className="text-fg">{sl.finalized?.toLocaleString() ?? sl.processed?.toLocaleString() ?? "?"}</span>
              </Line>
            )}
            {row.status === "dropped" && (
              <Line t0={t0} color="text-red">
                {row.failureClass ?? "failed"}
                {row.failureDetail ? (
                  <span className="block pl-3 text-dim">{row.failureDetail.slice(0, 120)}</span>
                ) : null}
              </Line>
            )}
            {row.status === "confirmed" && (
              <div className="pl-14 text-dim blink">▸ Awaiting finalization…</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-2">
            <Meta k="Bundle" v={`B${row.index} · attempt ${row.attempt}`} />
            <Meta k="Type" v={row.faultInjected ? "Fault injection" : "Jito bundle"} />
            {row.targetLeaderSlot != null && (
              <Meta k="Target leader slot" v={row.targetLeaderSlot.toLocaleString()} />
            )}
            {procToConf != null && <Meta k="processed→confirmed" v={ms(procToConf)} />}
            {confToFinal != null && <Meta k="confirmed→finalized" v={ms(confToFinal)} />}
          </div>

          {attempts.length > 1 && (
            <div className="border-t border-line pt-2">
              <div className="text-dim text-[9px] uppercase tracking-wide mb-1.5">
                Retry ladder · {attempts.length} attempts
              </div>
              <div className="space-y-1">
                {attempts.map((a) => (
                  <div key={a.signature} className="flex items-center gap-2 text-[10px]">
                    <span className="text-dim w-10 shrink-0">B{a.index}.{a.attempt}</span>
                    <span className="tabular-nums text-fg/90 w-20 shrink-0">{lamportsToSol(a.tipLamports, 4)} SOL</span>
                    <span className="ml-auto"><Chip status={a.status} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {row.landed && (
            <div className="mt-auto pt-2 border-t border-line">
              <a
                href={explorer(row.signature)}
                target="_blank"
                rel="noreferrer"
                className="text-cyan hover:underline text-[10px]"
              >
                verify on explorer ↗
              </a>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
