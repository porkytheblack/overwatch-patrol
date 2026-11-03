import type { ReactNode } from 'react';

// Schematic of a fictional depot: fenced compound, two warehouses, an
// office, and a four-waypoint patrol loop. viewBox is 400 × 300.

export type WaypointId = 'gate' | 'yard' | 'north' | 'dock';

export const WAYPOINTS: Record<WaypointId, { x: number; y: number; code: string; name: string; lx: number; ly: number; anchor?: 'start' | 'end' | 'middle' }> = {
  gate: { x: 200, y: 266, code: 'WP-01', name: 'FRONT GATE', lx: 212, ly: 262, anchor: 'start' },
  yard: { x: 190, y: 172, code: 'WP-02', name: 'YARD', lx: 178, ly: 168, anchor: 'end' },
  north: { x: 300, y: 60, code: 'WP-03', name: 'NORTH FENCE', lx: 300, ly: 51, anchor: 'middle' },
  dock: { x: 300, y: 228, code: 'WP-04', name: 'LOADING DOCK', lx: 300, ly: 246, anchor: 'middle' },
};

/** The patrol loop the robot follows, starting and ending at the gate. */
export const ROUTE = 'M200 266 L190 172 L225 150 L225 60 L360 60 L360 228 L300 228 L200 266';

export function SiteMap({
  children,
  activeWaypoint,
  className = '',
  showLabels = true,
}: {
  children?: ReactNode;
  activeWaypoint?: WaypointId | null;
  className?: string;
  showLabels?: boolean;
}) {
  return (
    <svg viewBox="0 0 400 300" className={`block h-full w-full ${className}`} role="img" aria-label="Site map with patrol route and four waypoints">
      <defs>
        <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#171717" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="400" height="300" fill="url(#map-grid)" />

      {/* Perimeter fence with a gap for the gate */}
      <path
        d="M185 284 L20 284 L20 24 L290 16 L385 40 L385 284 L215 284"
        fill="none"
        stroke="#404040"
        strokeWidth="1"
        strokeDasharray="5 3"
      />
      <path d="M185 284 L185 278 M215 284 L215 278" stroke="#525252" />

      {/* Buildings */}
      <g fill="#111" stroke="#2e2e2e">
        <rect x="60" y="52" width="150" height="88" />
        <rect x="245" y="85" width="95" height="115" />
        <rect x="50" y="190" width="80" height="55" />
        <rect x="142" y="198" width="22" height="10" />
        <rect x="142" y="211" width="22" height="10" />
        <rect x="142" y="224" width="22" height="10" />
      </g>
      {/* Dock bays on the south face of warehouse B */}
      <g stroke="#3a3a3a">
        <path d="M262 200v6M282 200v6M302 200v6M322 200v6" />
      </g>
      <g className="mono" fontSize="7" fill="#525252" letterSpacing="0.08em">
        <text x="135" y="99" textAnchor="middle">WAREHOUSE A</text>
        <text x="292" y="145" textAnchor="middle">WAREHOUSE B</text>
        <text x="90" y="220" textAnchor="middle">OFFICE</text>
      </g>

      {/* Patrol route */}
      <path d={ROUTE} fill="none" stroke="#f59e0b" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 4" />

      {/* Waypoints */}
      {(Object.keys(WAYPOINTS) as WaypointId[]).map((id) => {
        const w = WAYPOINTS[id];
        const active = activeWaypoint === id;
        return (
          <g key={id}>
            <rect
              x={w.x - 4}
              y={w.y - 4}
              width="8"
              height="8"
              fill={active ? '#f59e0b' : '#0a0a0a'}
              stroke={active ? '#f59e0b' : '#737373'}
              style={{ transition: 'fill 300ms, stroke 300ms' }}
            />
            {showLabels ? (
              <text
                x={w.lx}
                y={w.ly}
                textAnchor={w.anchor ?? 'start'}
                className="mono"
                fontSize="7"
                letterSpacing="0.06em"
                fill={active ? '#fbbf24' : '#a3a3a3'}
                style={{ transition: 'fill 300ms' }}
              >
                <tspan fill={active ? '#f59e0b' : '#525252'}>{w.code} </tspan>
                {w.name}
              </text>
            ) : null}
          </g>
        );
      })}

      {children}
    </svg>
  );
}

/** Robot glyph: amber square with a translucent field-of-view wedge pointing +x. */
export function RobotGlyph() {
  return (
    <g>
      <path d="M0 0 L30 -13 L30 13 Z" fill="#f59e0b" fillOpacity="0.1" stroke="#f59e0b" strokeOpacity="0.25" strokeWidth="0.75" />
      <rect x="-4" y="-4" width="8" height="8" fill="#f59e0b" />
      <rect x="-1.5" y="-1.5" width="3" height="3" fill="#0a0a0a" />
    </g>
  );
}

/** Pulsing detection marker. */
export function DetectionMarker({ x, y, label }: { x: number; y: number; label?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="4" fill="none" stroke="#f59e0b" className="ping" />
      <path d="M0 -4 L4 0 L0 4 L-4 0 Z" fill="#f59e0b" />
      {label ? (
        <text x="8" y="3" className="mono" fontSize="7" fill="#fbbf24" letterSpacing="0.06em">
          {label}
        </text>
      ) : null}
    </g>
  );
}
