import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * R67 — a tiny dependency-free SVG sparkline for the liquid drift-history trend.
 * Renders an area + line from a series of numeric values. Convergence (values
 * trending down toward 0) reads as "good"; divergence (trending up) as "watch".
 */
export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Stroke + fill hue. */
  tone?: "emerald" | "amber" | "sky" | "muted";
  /** Optional baseline (e.g. the alert threshold) drawn as a dashed rule. */
  threshold?: number;
}

const TONES: Record<NonNullable<SparklineProps["tone"]>, string> = {
  emerald: "#34d399",
  amber: "#fbbf24",
  sky: "#38bdf8",
  muted: "#94a3b8",
};

export function Sparkline({
  values,
  width = 120,
  height = 32,
  className,
  tone = "sky",
  threshold,
}: SparklineProps) {
  const gradId = useId();
  if (!values || values.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-[10px] text-muted-foreground/60", className)}
        style={{ width, height }}
      >
        not enough history yet
      </div>
    );
  }

  const pad = 2;
  const w = width;
  const h = height;
  const min = Math.min(...values, threshold ?? Infinity);
  const max = Math.max(...values, threshold ?? -Infinity);
  const span = max - min || 1;
  const stroke = TONES[tone];

  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);

  const linePts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const areaPath =
    `M ${x(0)},${y(values[0])} ` +
    values.map((v, i) => `L ${x(i)},${y(v)}`).join(" ") +
    ` L ${x(values.length - 1)},${h - pad} L ${x(0)},${h - pad} Z`;

  const thresholdY =
    typeof threshold === "number" && threshold >= min && threshold <= max ? y(threshold) : null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="img"
      aria-label="Drift history trend"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {thresholdY != null && (
        <line
          x1={pad}
          y1={thresholdY}
          x2={w - pad}
          y2={thresholdY}
          stroke="#f59e0b"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        points={linePts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2} fill={stroke} />
    </svg>
  );
}
