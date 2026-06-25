import { type DashState } from "@/lib/store";
import { Panel } from "./ui";
import { slotStatusLabel } from "@/lib/events";

const FILL: Record<string, number> = { processed: 1, confirmed: 2, finalized: 4 };
const BAR: Record<string, string> = {
  processed: "bg-amber",
  confirmed: "bg-cyan",
  finalized: "bg-green",
};
const TXT: Record<string, string> = {
  processed: "text-amber",
  confirmed: "text-cyan",
  finalized: "text-green",
};

export function SlotFeed({ s, className }: { s: DashState; className?: string }) {
  const items = s.slotFeed.slice(0, 48);
  return (
    <Panel title="Live Slot Feed" className={className} bodyClass="overflow-auto px-3 py-2">
      {items.length === 0 ? (
        <div className="text-dim text-[11px]">awaiting slots…</div>
      ) : (
        <div className="space-y-[5px]">
          {items.map((it, i) => {
            const lab = slotStatusLabel(it.status);
            const fill = FILL[lab];
            return (
              <div
                key={`${it.slot}-${i}`}
                className={`flex items-center justify-between text-[11px] ${i === 0 ? "flash" : ""}`}
              >
                <span className="text-fg/90 tabular-nums">{it.slot.toLocaleString()}</span>
                <span className="flex gap-[2px] items-end">
                  {[1, 2, 3, 4].map((b) => (
                    <span
                      key={b}
                      className={`w-[3px] h-3 rounded-[1px] ${b <= fill ? BAR[lab] : "bg-line2"} ${
                        b <= fill ? "" : "opacity-60"
                      }`}
                    />
                  ))}
                  <span className={`ml-1 text-[8px] uppercase tracking-wide ${TXT[lab]}`}>
                    {lab[0]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
