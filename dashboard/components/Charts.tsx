import { type DashState } from "@/lib/store";
import { Panel, Bars } from "./ui";
import { ms } from "@/lib/format";

export function ConfLatencyChart({ s }: { s: DashState }) {
  const vals = s.confLatencies.slice(-14);
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return (
    <Panel
      title="Conf Latency (1h)"
      right={<span className="text-[10px] text-fg tabular-nums">{med ? ms(med) : "—"}</span>}
      bodyClass="px-3 py-3"
    >
      <div className="h-full min-h-[60px]">
        {vals.length ? (
          <Bars values={vals} color="bg-cyan" highlightLast />
        ) : (
          <div className="text-dim text-[11px]">no confirmations yet</div>
        )}
      </div>
    </Panel>
  );
}

export function TipSuccessChart({ s }: { s: DashState }) {
  const pts = s.tipResults.slice(-60);
  const min = Math.log10(1000);
  const max = Math.log10(3_000_000);
  const x = (tip: number) => {
    const v = Math.log10(Math.max(1000, Math.min(3_000_000, tip || 1000)));
    return 6 + ((v - min) / (max - min)) * 88;
  };
  return (
    <Panel title="Tip vs Success" bodyClass="px-2 py-2">
      <svg viewBox="0 0 100 64" className="w-full h-full min-h-[60px]">
        <line x1="6" y1="54" x2="94" y2="54" stroke="#19242e" strokeWidth="0.4" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={x(p.tip)}
            cy={p.landed ? 14 + ((i * 7) % 16) : 30 + ((i * 11) % 20)}
            r={1.7}
            fill={p.landed ? "#3fd17e" : "#ef5b6b"}
            opacity={0.85}
          />
        ))}
        <text x="6" y="62" fontSize="3.4" fill="#5d7282">
          1k
        </text>
        <text x="86" y="62" fontSize="3.4" fill="#5d7282">
          3M lpt
        </text>
      </svg>
    </Panel>
  );
}

export function NetworkLoad({ s }: { s: DashState }) {
  const load = Math.max(0, Math.min(1, (s.congestion - 0.8) / 1.7));
  const col = load > 0.66 ? "text-red" : load > 0.4 ? "text-amber" : "text-green";
  return (
    <Panel title="Network Load" bodyClass="px-3 py-3 flex flex-col items-center justify-center">
      <div className={`text-3xl font-bold tabular-nums ${col}`}>{Math.round(load * 100)}%</div>
      <div className="text-[9px] text-dim mt-1">congestion {s.congestion.toFixed(2)}×</div>
    </Panel>
  );
}
