import { type DashState } from "@/lib/store";
import { compact, shortSig } from "@/lib/format";

export type View = "dashboard" | "decisions" | "logs" | "architecture";
const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "decisions", label: "Decisions" },
  { id: "logs", label: "Logs" },
  { id: "architecture", label: "Architecture" },
];

function congestionLabel(c: number): string {
  return c < 1.1 ? "Low" : c < 1.7 ? "Med" : "High";
}

function Stat({ k, v, accent = "text-fg" }: { k: string; v: string; accent?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-dim">{k}: </span>
      <span className={accent}>{v}</span>
    </span>
  );
}

export function TopBar({
  s,
  view,
  onView,
}: {
  s: DashState;
  view: View;
  onView: (v: View) => void;
}) {
  const jitoNext = s.leader ? `${Math.max(0, Math.round(s.leader.gap * 0.4))}s` : "—";
  const done = !!s.done;
  const dot = done
    ? "bg-cyan"
    : s.mode === "live"
      ? "bg-green pulse-dot"
      : s.mode === "replay"
        ? "bg-cyan"
        : "bg-amber pulse-dot";
  const modeColor = done
    ? "text-cyan"
    : s.mode === "live"
      ? "text-green"
      : s.mode === "replay"
        ? "text-cyan"
        : "text-amber";
  // A finished campaign keeps the SSE server alive but the slot stream stops, so
  // the board looks frozen — label it COMPLETE (with the result) instead of LIVE.
  const modeLabel = done ? `COMPLETE · ${s.done!.landed}/${s.done!.total} landed` : s.mode.toUpperCase();

  return (
    <header className="flex items-center gap-5 px-4 h-12 border-b border-line bg-panel/70 backdrop-blur shrink-0">
      <div className="flex items-baseline gap-2 shrink-0">
        <span className="text-cyan font-bold tracking-[0.25em] text-sm">SLIPSTREAM</span>
        <span className="text-[10px] text-dim hidden md:inline">smart tx stack</span>
      </div>

      <div className="flex items-center gap-4 text-[11px] overflow-x-auto no-scrollbar">
        <Stat k="Slot" v={s.currentSlot ? s.currentSlot.toLocaleString() : "—"} />
        <Stat k="Leader" v={s.leader ? shortSig(s.leader.identity, 4, 0) : "—"} />
        <Stat k="Jito Next" v={jitoNext} accent="text-cyan" />
        <Stat k="Congestion" v={`${s.congestion.toFixed(2)}× ${congestionLabel(s.congestion)}`} />
        <Stat k="Tip Floor" v={s.tipFloor ? `${compact(s.tipFloor.ema50)} lpt` : "—"} />
      </div>

      <div className="ml-auto flex items-center gap-4 text-[11px] shrink-0">
        <span className={`flex items-center gap-1.5 ${modeColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${dot}`} />
          {modeLabel}
        </span>
        <nav className="hidden lg:flex items-center gap-3 text-dim">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onView(n.id)}
              className={`pb-0.5 transition-colors hover:text-fg ${
                view === n.id ? "text-fg border-b border-cyan" : "border-b border-transparent"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
