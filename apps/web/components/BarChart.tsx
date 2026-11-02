'use client';
import { useState } from 'react';

/**
 * Single-series column chart: one hue, 4px rounded data-ends on a shared
 * baseline, recessive grid, hover tooltip with a hit area wider than the bar.
 */
export function BarChart({
  data,
  format,
  height = 200,
  label,
  highlight,
}: {
  data: { key: string; label: string; value: number; tip?: string }[];
  format: (n: number) => string;
  height?: number;
  label: string;
  highlight?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const W = 640;
  const H = height;
  const padL = 44;
  const padB = 22;
  const plotW = W - padL - 4;
  const plotH = H - padB - 8;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(28, slot - 2)); // ≥2px gap between bars
  const ticks = [0, nice / 2, nice];
  const every = Math.ceil(data.length / 12);

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / nice) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - 4} y1={y} y2={y} stroke="#cfe2d7" strokeWidth={t === 0 ? 1 : 0.6} strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#7d8f85" className="num">{compact(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / nice) * plotH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = 8 + plotH - h;
          const active = hover === i || d.key === highlight;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.tip ?? d.label} ${format(d.value)}`}>
              <rect x={padL + i * slot} y={8} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, y, barW, h, Math.min(4, barW / 2, h))} fill={active ? '#0a4f32' : '#1e8c5a'} className="bar" />}
              {i % every === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#7d8f85">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
          style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%`, top: `${((8 + plotH - (data[hover].value / nice) * plotH) / H) * 100}%`, marginTop: -6 }}
        >
          <span className="text-white/70">{data[hover].tip ?? data[hover].label}</span> <span className="num">{format(data[hover].value)}</span>
        </div>
      )}
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compact(n: number) {
  if (n >= 1000) return `${(n / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 })}k`;
  return String(n);
}

/** Horizontal meter for "share of time used". */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-mist" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="meter-fill h-full rounded-full bg-felt" style={{ width: `${Math.max(value, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}
