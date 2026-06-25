import { type ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <div className={`panel flex flex-col min-h-0 overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
          <span className="label">{title}</span>
          {right}
        </div>
      )}
      <div className={`flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </div>
  );
}

export const statusBg: Record<string, string> = {
  submitted: "bg-cyan/10 text-cyan border-cyan/30",
  processing: "bg-amber/10 text-amber border-amber/30",
  processed: "bg-amber/10 text-amber border-amber/30",
  confirmed: "bg-green/10 text-green border-green/30",
  finalized: "bg-green/10 text-green border-green/30",
  dropped: "bg-red/10 text-red border-red/30",
  aborted: "bg-dim/10 text-dim border-dim/40",
};

export function Chip({ status }: { status: string }) {
  const cls = statusBg[status] ?? "bg-dim/10 text-dim border-dim/30";
  return (
    <span
      className={`inline-block px-1.5 py-[1px] text-[9px] tracking-[0.12em] uppercase rounded border ${cls}`}
    >
      {status}
    </span>
  );
}

export function Bars({
  values,
  max,
  color = "bg-cyan",
  highlightLast = false,
}: {
  values: number[];
  max?: number;
  color?: string;
  highlightLast?: boolean;
}) {
  const m = max ?? Math.max(1, ...values);
  return (
    <div className="flex items-end gap-[2px] h-full w-full">
      {values.map((v, i) => {
        const h = Math.max(5, (v / m) * 100);
        const last = highlightLast && i === values.length - 1;
        return (
          <div
            key={i}
            className={`flex-1 rounded-sm ${last ? "bg-amber" : color}`}
            style={{ height: `${h}%`, opacity: last ? 1 : 0.5 + 0.5 * (v / m) }}
          />
        );
      })}
    </div>
  );
}

export function Ring({ value, sub }: { value: number; sub?: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  const col = value >= 0.75 ? "#3fd17e" : value >= 0.45 ? "#aef03a" : "#f0a73a";
  return (
    <svg viewBox="0 0 140 140" className="w-full h-full">
      <circle cx="70" cy="70" r={r} stroke="#19242e" strokeWidth="9" fill="none" />
      <circle
        cx="70"
        cy="70"
        r={r}
        stroke={col}
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 70 70)"
        style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s" }}
      />
      <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="700" fill="#e6eef5">
        {(value * 100).toFixed(1)}%
      </text>
      {sub && (
        <text x="70" y="86" textAnchor="middle" fontSize="9" letterSpacing="2" fill="#5d7282">
          {sub}
        </text>
      )}
    </svg>
  );
}
