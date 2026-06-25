import { type DashState, slotJitter } from "@/lib/store";
import { Panel, Bars } from "./ui";
import { ms } from "@/lib/format";

function Meter({ label, value, frac, color }: { label: string; value: string; frac: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="label">{label}</span>
        <span className="text-fg tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 bg-line2 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full`}
          style={{ width: `${Math.max(4, Math.min(100, frac * 100))}%`, transition: "width 0.5s" }}
        />
      </div>
    </div>
  );
}

export function NetworkHealth({ s }: { s: DashState }) {
  const jitter = slotJitter(s.slotTimes);
  const lat = s.confLatencies.slice(-18);
  const sorted = [...lat].sort((a, b) => a - b);
  const medLat = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  return (
    <Panel title="Network Health" bodyClass="px-3 py-3 space-y-3.5">
      <Meter
        label="Slot Jitter"
        value={`${jitter}ms`}
        frac={Math.min(1, jitter / 120)}
        color={jitter > 80 ? "bg-amber" : "bg-cyan"}
      />
      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="label">Conf Latency</span>
          <span className="text-fg tabular-nums">{medLat ? ms(medLat) : "—"}</span>
        </div>
        <div className="h-9">
          <Bars values={lat.length ? lat : [1, 1, 1]} color="bg-cyan" />
        </div>
      </div>
    </Panel>
  );
}
