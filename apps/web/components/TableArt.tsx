/**
 * A snooker table seen from above. The lamp over it is the status:
 * playing = lamp on, paused = lamp dimmed, reserved = yellow ball spotted, free = lamp off.
 */
export type TableState = 'free' | 'playing' | 'paused' | 'reserved';

export function TableArt({ state, className = '', title }: { state: TableState; className?: string; title?: string }) {
  const lit = state === 'playing' || state === 'paused';
  return (
    <svg viewBox="0 0 200 112" className={`table-art block w-full ${className}`} data-state={state} role="img" aria-label={title}>
      <defs>
        <radialGradient id="lamp" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* wooden rail */}
      <rect x="1" y="1" width="198" height="110" rx="12" fill="#6e4326" />
      <rect x="4" y="4" width="192" height="104" rx="10" fill="#5a361f" opacity="0.5" />
      {/* cushions + baize */}
      <rect x="11" y="11" width="178" height="90" rx="4" className="baize" />
      <rect x="15" y="15" width="170" height="82" rx="2" className="baize-bed" />
      {/* baulk line + D */}
      <line x1="52" y1="15" x2="52" y2="97" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="0.8" />
      <path d="M52 41 A15 15 0 0 0 52 71" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="0.8" />
      {/* pockets */}
      {[[12, 12], [100, 9], [188, 12], [12, 100], [100, 103], [188, 100]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5.2" fill="#0d0f0e" />
      ))}
      {/* lamp light */}
      <rect x="15" y="15" width="170" height="82" rx="2" fill="url(#lamp)" className="lamp" />
      {lit && (
        <g className="balls">
          <circle cx="148" cy="56" r="3.3" fill="#1b1b1b" />
          {[[128, 52], [128, 60], [123, 56], [118, 48], [118, 64], [133, 44]].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="3.1" fill="#b3261e" />
          ))}
          <circle cx="104" cy="56" r="3.1" fill="#e8669a" />
          <circle cx="70" cy="66" r="3.3" fill="#f7f5ef" />
        </g>
      )}
      {state === 'reserved' && <circle cx="52" cy="71" r="4.6" fill="#d49a1f" className="reserved-ball" />}
    </svg>
  );
}
