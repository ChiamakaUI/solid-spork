export function shortSig(s?: string, head = 5, tail = 4): string {
  if (!s) return "—";
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function explorer(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

/** 1606 → "1.6k", 300000 → "300k", 2800000 → "2.8M". */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}k`;
  return `${n}`;
}

/** lamports → SOL string, e.g. 2_800_000 → "0.0028". */
export function lamportsToSol(l: number, dp = 4): string {
  return (l / 1e9).toFixed(dp);
}

export function pct(n: number, dp = 1): string {
  return `${(n * 100).toFixed(dp)}%`;
}

/** "T-12s", "T-3m" relative to now. */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `T-${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `T-${m}m`;
  return `T-${Math.round(m / 60)}h`;
}

export function ms(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}ms`;
}
