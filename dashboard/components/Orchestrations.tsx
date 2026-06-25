import { type DashState } from "@/lib/store";
import { Panel, Chip } from "./ui";
import { explorer, lamportsToSol, shortSig } from "@/lib/format";

function Foot({ k, v, c = "text-fg" }: { k: string; v: string; c?: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-dim uppercase tracking-wide text-[9px]">{k}</span>
      <span className={`tabular-nums ${c}`}>{v}</span>
    </span>
  );
}

export function Orchestrations({ s }: { s: DashState }) {
  const rows = s.rows.slice(0, 40);
  const dropped = s.rows.filter((r) => r.status === "dropped" || r.status === "aborted").length;
  const tipSpent = s.rows.reduce((sum, r) => sum + (r.landed ? r.tipLamports : 0), 0);
  const total = s.total || s.rows.length;

  return (
    <Panel
      title="Live Orchestrations"
      right={<span className="text-[10px] text-dim">{s.rows.length} attempts</span>}
      bodyClass="flex flex-col min-h-0"
    >
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="text-dim sticky top-0 bg-panel">
            <tr className="text-left">
              <th className="font-normal px-3 py-1.5">SIGNATURE</th>
              <th className="font-normal px-2 py-1.5">TYPE</th>
              <th className="font-normal px-2 py-1.5">STATUS</th>
              <th className="font-normal px-3 py-1.5 text-right">TIP (SOL)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-dim">
                  awaiting first bundle…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.signature} className="border-t border-line/60 hover:bg-panel2">
                <td className="px-3 py-1.5">
                  {r.landed ? (
                    <a
                      href={explorer(r.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan hover:underline"
                    >
                      {shortSig(r.signature)}
                    </a>
                  ) : (
                    <span className="text-fg/80">{shortSig(r.signature)}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-dim">
                  {r.faultInjected ? "Fault Inj" : "Jito Bundle"}
                  <span className="text-line2"> · B{r.index}.{r.attempt}</span>
                </td>
                <td className="px-2 py-1.5">
                  <Chip status={r.status} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-fg/90">
                  {lamportsToSol(r.tipLamports, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2 flex items-center justify-between text-[10px]">
        <Foot k="Bundles" v={`${s.landed}/${total}`} c="text-green" />
        <Foot k="Attempts" v={String(s.rows.length)} />
        <Foot k="Dropped" v={String(dropped)} c={dropped ? "text-red" : "text-dim"} />
        <Foot k="Tips spent" v={`${lamportsToSol(tipSpent, 4)} SOL`} c="text-cyan" />
      </div>
    </Panel>
  );
}
