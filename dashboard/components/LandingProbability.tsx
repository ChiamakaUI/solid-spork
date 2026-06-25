import { type DashState, landingProbability } from "@/lib/store";
import { Panel, Ring } from "./ui";

export function LandingProbability({ s }: { s: DashState }) {
  const p = landingProbability(s);
  const label = p >= 0.75 ? "OPTIMAL" : p >= 0.45 ? "VIABLE" : "BELOW FLOOR";
  return (
    <Panel
      title="Landing Probability"
      right={<span className="text-[9px] text-dim">estimate</span>}
      bodyClass="px-3 py-3 flex flex-col items-center justify-center"
    >
      <div className="w-32 h-32">
        <Ring value={p} sub={label} />
      </div>
      <div className="mt-1 text-[9px] text-dim text-center leading-snug">
        tip vs floor · congestion · leader window
      </div>
    </Panel>
  );
}
