import { type DashState } from "@/lib/store";
import { Panel } from "./ui";
import { shortSig } from "@/lib/format";

export function LeaderSchedule({ s }: { s: DashState }) {
  const l = s.leader;
  return (
    <Panel title="Leader Schedule" bodyClass="px-3 py-2">
      {!l ? (
        <div className="text-dim text-[11px]">—</div>
      ) : (
        <div className="space-y-2.5 text-[11px]">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan inline-block pulse-dot" />
              <span className="text-fg">Current slot</span>
            </div>
            <div className="pl-3.5 text-dim tabular-nums">{s.currentSlot.toLocaleString()}</div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-violet inline-block" />
              <span className="text-fg">Next Jito leader</span>
            </div>
            <div className="pl-3.5 text-dim">
              slot {l.nextLeaderSlot.toLocaleString()} · {shortSig(l.identity, 6, 0)}
            </div>
            <div className="pl-3.5 text-cyan">
              {l.gap <= 0 ? "in window now ◀" : `${l.gap} slots away · ~${Math.round(l.gap * 0.4)}s`}
            </div>
          </div>
          <div className="pt-1 border-t border-line text-[10px] text-dim leading-relaxed">
            bundles execute only inside Jito leaders&apos; blocks — we time the window before
            sending.
          </div>
        </div>
      )}
    </Panel>
  );
}
