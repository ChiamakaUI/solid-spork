"use client";

import { useState } from "react";
import { useDashboard, useNow } from "@/lib/useDashboard";
import { type OrchRow } from "@/lib/events";
import { TopBar, type View } from "@/components/TopBar";
import { DecisionsView } from "@/components/DecisionsView";
import { LogsView } from "@/components/LogsView";
import { ArchitectureView } from "@/components/ArchitectureView";
import { SlotFeed } from "@/components/SlotFeed";
import { LeaderSchedule } from "@/components/LeaderSchedule";
import { NetworkHealth } from "@/components/NetworkHealth";
import { ExecutionPipeline } from "@/components/ExecutionPipeline";
import { Orchestrations } from "@/components/Orchestrations";
import { TracePanel } from "@/components/TracePanel";
import { LandingProbability } from "@/components/LandingProbability";
import { ControlPanel } from "@/components/ControlPanel";
import { AIDecisions } from "@/components/AIDecisions";
import { RecoveryPanel } from "@/components/RecoveryPanel";
import { ConfLatencyChart, TipSuccessChart, NetworkLoad } from "@/components/Charts";

function pickActive(rows: OrchRow[]): OrchRow | undefined {
  return (
    rows.find((r) => ["submitted", "processing", "processed", "confirmed"].includes(r.status)) ??
    rows[0]
  );
}

export default function Page() {
  const s = useDashboard();
  const now = useNow();
  const active = pickActive(s.rows);
  const attempts = active
    ? s.rows.filter((r) => r.entryId === active.entryId).sort((a, b) => a.attempt - b.attempt)
    : [];
  const [view, setView] = useState<View>("dashboard");

  return (
    <div className="h-screen flex flex-col scanline">
      <TopBar s={s} view={view} onView={setView} />

      {view === "architecture" ? (
        <main className="flex-1 min-h-0 overflow-hidden">
          <ArchitectureView />
        </main>
      ) : view === "decisions" ? (
        <main className="flex-1 min-h-0 p-2 overflow-hidden">
          <DecisionsView s={s} now={now} />
        </main>
      ) : view === "logs" ? (
        <main className="flex-1 min-h-0 p-2 overflow-hidden">
          <LogsView s={s} now={now} />
        </main>
      ) : (
      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_1fr_320px] gap-2 p-2 overflow-auto lg:overflow-hidden">
        {/* LEFT */}
        <div className="flex flex-col gap-2 min-h-0">
          <SlotFeed s={s} className="flex-1 min-h-[160px]" />
          <LeaderSchedule s={s} />
          <NetworkHealth s={s} />
        </div>

        {/* CENTER */}
        <div className="flex flex-col gap-2 min-h-0">
          <ExecutionPipeline row={active} />
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-2 flex-1 min-h-[220px]">
            <Orchestrations s={s} />
            <TracePanel row={active} attempts={attempts} />
          </div>
          <div className="grid grid-cols-3 gap-2 h-[118px] shrink-0">
            <ConfLatencyChart s={s} />
            <TipSuccessChart s={s} />
            <NetworkLoad s={s} />
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-2 min-h-0">
          <ControlPanel s={s} />
          <LandingProbability s={s} />
          <AIDecisions s={s} now={now} className="flex-1 min-h-[180px]" />
          <RecoveryPanel s={s} now={now} />
        </div>
      </main>
      )}

      <footer className="shrink-0 flex items-center gap-4 px-4 h-7 border-t border-line bg-panel/60 text-[10px] text-dim">
        <span>
          landed <span className="text-green">{s.landed}</span>/{s.total || s.rows.length || "—"}
        </span>
        {s.campaign && (
          <span className="hidden md:inline">
            net <span className="text-fg">{s.campaign.network}</span> · engine{" "}
            <span className="text-fg">{s.campaign.blockEngine?.split(".")[0]}</span> · agent{" "}
            <span className="text-violet">{s.campaign.agentModel}</span>
          </span>
        )}
        <span className="ml-auto">
          {s.mode === "replay"
            ? "REPLAY — recorded mainnet campaign · append ?live for a running campaign"
            : s.mode === "live"
              ? "LIVE — streaming from local campaign"
              : s.mode === "connecting"
                ? "connecting to local campaign…"
                : "idle"}
        </span>
      </footer>
    </div>
  );
}
