"use client";

import { useEffect, useState } from "react";
import { type DashState } from "@/lib/store";
import { LIVE_BASE } from "@/lib/useDashboard";
import { Panel } from "./ui";

interface Preflight {
  address: string;
  balanceSol: number;
  guardSol: number;
  ok: boolean;
  landingCostSol: number;
  affordableBundles: number;
}

/**
 * Ops control: check the payer balance and launch a campaign from the browser.
 * Renders only in live mode against a server that exposes the control routes —
 * so it's invisible in the hosted replay build (which has no such server), and
 * the real-SOL "Start" button stays local-only.
 */
export function ControlPanel({ s }: { s: DashState }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [bundles, setBundles] = useState(8);
  const [faults, setFaults] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const running = s.run?.state === "running";

  // Probe for control availability + initial balance, but only when live.
  useEffect(() => {
    if (s.mode !== "live") {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    fetch(`${LIVE_BASE}/preflight`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no control"))))
      .then((d: Preflight) => {
        if (!cancelled) {
          setAvailable(true);
          setPf(d);
        }
      })
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [s.mode]);

  if (s.mode !== "live" || available !== true) return null;

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${LIVE_BASE}/preflight`);
      setPf(await r.json());
    } catch {
      setMsg("balance check failed");
    }
    setBusy(false);
  };

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${LIVE_BASE}/campaign/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundles, faults }),
      });
      const d = await r.json();
      if (r.status === 202) setMsg(`launched ${d.bundles} bundles${d.faults ? `, ${d.faults} fault-injected` : ""}…`);
      else if (r.status === 409) setMsg("a campaign is already running");
      else {
        setMsg(d.error ?? `error ${r.status}`);
        if (d.address) setPf(d); // 400 low-balance carries the preflight
      }
    } catch {
      setMsg("start request failed");
    }
    setBusy(false);
  };

  const copy = () => {
    if (!pf) return;
    navigator.clipboard?.writeText(pf.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const low = pf != null && !pf.ok;
  const overBudget = pf != null && pf.ok && bundles > pf.affordableBundles;
  const statusLine =
    msg ??
    (s.run?.state === "running"
      ? `campaign running · ${s.landed}/${s.total || "?"} landed so far`
      : s.run?.state === "complete"
        ? `complete · ${s.run.landed}/${s.run.total} landed`
        : s.run?.state === "error"
          ? `error: ${s.run.error}`
          : null);

  return (
    <Panel
      title="Control"
      right={<span className="text-[9px] text-dim">local</span>}
      bodyClass="px-3 py-3 flex flex-col gap-2 text-[11px]"
    >
      <div className="flex items-center justify-between">
        <span className="text-dim">payer balance</span>
        <span className={low ? "text-red" : "text-green"}>
          {pf ? `${pf.balanceSol.toFixed(4)} SOL` : "—"}
        </span>
      </div>

      {low ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-red text-[10px] leading-snug">
            below the {pf!.guardSol} SOL floor — top up this address:
          </div>
          <button
            type="button"
            onClick={copy}
            className="text-left font-mono text-[10px] break-all bg-black/30 border border-line rounded px-2 py-1 hover:border-cyan/50"
          >
            {pf!.address}
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded px-2 py-1 border border-line text-dim hover:text-fg disabled:opacity-50"
          >
            {copied ? "address copied ✓" : busy ? "checking…" : "re-check balance"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label className="text-dim">bundles</label>
            <input
              type="number"
              min={1}
              max={50}
              value={bundles}
              onChange={(e) => setBundles(Math.max(1, Math.min(50, +e.target.value || 1)))}
              disabled={running}
              className="w-14 bg-black/30 border border-line rounded px-1.5 py-0.5 text-fg disabled:opacity-50"
            />
            <label className="text-dim">faults</label>
            <input
              type="number"
              min={0}
              max={bundles}
              value={faults}
              onChange={(e) => setFaults(Math.max(0, Math.min(bundles, +e.target.value || 0)))}
              disabled={running}
              className="w-12 bg-black/30 border border-line rounded px-1.5 py-0.5 text-fg disabled:opacity-50"
            />
          </div>
          {pf && (
            <div className={`text-[10px] leading-snug ${overBudget ? "text-amber" : "text-dim"}`}>
              est ≈ {(bundles * pf.landingCostSol).toFixed(4)} SOL · balance covers ~{pf.affordableBundles} landed bundle
              {pf.affordableBundles === 1 ? "" : "s"} (~{pf.landingCostSol.toFixed(4)} ea)
              {overBudget && ` — reduce to ${pf.affordableBundles} or top up`}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={start}
              disabled={busy || running || overBudget}
              className={`flex-1 rounded px-2 py-1.5 border tracking-wide disabled:opacity-50 ${
                running
                  ? "border-amber/40 text-amber"
                  : "border-green/40 text-green hover:bg-green/10"
              }`}
            >
              {running ? "running…" : "▶ Start campaign"}
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={busy || running}
              title="re-check balance"
              className="rounded px-2 py-1.5 border border-line text-dim hover:text-fg disabled:opacity-50"
            >
              ↻
            </button>
          </div>
        </>
      )}

      {statusLine && <div className="text-[10px] text-dim leading-snug">{statusLine}</div>}
    </Panel>
  );
}
