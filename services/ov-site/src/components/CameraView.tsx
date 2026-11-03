// Schematic robot-camera frames. Three scenes share one perspective rig:
//  - dock-person:   loading-dock wall, person lingering near bay 3
//  - fence-vehicle: perimeter fence, van stopped outside it
//  - gate-clear:    vehicle gate, nothing tracked

export type CameraScene = 'dock-person' | 'fence-vehicle' | 'gate-clear';

const VX = 160;
const VY = 78;
const RAYS = [-260, -170, -90, -20, 50, 120, 190, 260, 340, 420, 520, 600];
const ROWS = [86, 94, 106, 122, 144, 172, 200];

function Ground() {
  return (
    <g stroke="#1b1b1b">
      {RAYS.map((x) => (
        <path key={x} d={`M${VX} ${VY} L${x} 200`} />
      ))}
      {ROWS.map((y) => (
        <path key={y} d={`M0 ${y} H320`} />
      ))}
    </g>
  );
}

function Fence({ from = 150, to = 320, y0 = 74, slope = 8 / 170, height = 14, post = 10 }) {
  const n = Math.floor((to - from) / post);
  const yAt = (x: number) => y0 - (x - from) * slope;
  return (
    <g>
      <path d={`M${from} ${yAt(from)} L${to} ${yAt(to)}`} stroke="#2a2a2a" />
      <path d={`M${from} ${yAt(from) - height} L${to} ${yAt(to) - height}`} stroke="#222" />
      {Array.from({ length: n }).map((_, i) => {
        const x = from + 18 + i * post;
        return <path key={i} d={`M${x} ${yAt(x)} v-${height}`} stroke="#222" />;
      })}
    </g>
  );
}

function DockWall() {
  // Wall edges: top y = 8 + 62x/150, bottom y = 150 − 64x/150.
  // Doors start 32% down the wall and run to the ground line.
  const wallH = (x: number) => 142 - (x * 126) / 150;
  const top = (x: number) => 8 + (x * 62) / 150 + 0.32 * wallH(x);
  const bot = (x: number) => 150 - (x * 64) / 150 - 1;
  return (
    <g>
      <path d="M0 8 L150 70 L150 86 L0 150 Z" fill="#131313" stroke="#2c2c2c" />
      {[
        [14, 40],
        [58, 92],
        [100, 126],
      ].map(([a, b], i) => (
        <g key={i}>
          <path d={`M${a} ${top(a)} L${b} ${top(b)} L${b} ${bot(b)} L${a} ${bot(a)} Z`} fill="#0f0f0f" stroke="#333" />
          <text x={(a + b) / 2} y={top(a) - 3} fontSize="5" className="mono" fill="#444" textAnchor="middle">
            BAY {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

function Person() {
  return (
    <g>
      <g fill="#5a5a5a">
        <circle cx="207" cy="108" r="5.2" />
        <path d="M199 115 h16 l2.5 22 h-4 l-1 -9 l-1 27 h-4.5 l-0.5 -18 l-0.5 18 h-4.5 l-1 -27 l-1 9 h-4 Z" />
      </g>
      <ellipse cx="207" cy="154" rx="12" ry="2" fill="#000" fillOpacity="0.5" />
    </g>
  );
}

function Van() {
  return (
    <g>
      <ellipse cx="236" cy="106" rx="44" ry="3" fill="#000" fillOpacity="0.5" />
      <path d="M196 104 V78 Q196 74 200 74 H252 L268 88 V104 Z" fill="#474747" stroke="#5a5a5a" strokeWidth="0.5" />
      <path d="M252 76 L265 88 H252 Z" fill="#2a2a2a" />
      <rect x="205" y="79" width="40" height="8" fill="#3a3a3a" />
      <circle cx="210" cy="104" r="5" fill="#1a1a1a" stroke="#555" strokeWidth="0.75" />
      <circle cx="255" cy="104" r="5" fill="#1a1a1a" stroke="#555" strokeWidth="0.75" />
      <rect x="264" y="92" width="4" height="3" fill="#777" />
    </g>
  );
}

function Track({ x, y, w, h, label, id }: { x: number; y: number; w: number; h: number; label: string; id: string }) {
  const c = 7;
  const tagW = label.length * 3.6 + 8;
  return (
    <g>
      <g stroke="#f59e0b" fill="none">
        <rect x={x} y={y} width={w} height={h} strokeOpacity="0.55" />
        <path
          d={`M${x} ${y + c}v-${c}h${c}M${x + w - c} ${y}h${c}v${c}M${x + w} ${y + h - c}v${c}h-${c}M${x + c} ${y + h}h-${c}v-${c}`}
          strokeWidth="1.5"
        />
      </g>
      <rect x={x} y={y - 9} width={tagW} height="9" fill="#f59e0b" />
      <text x={x + 3} y={y - 2.4} fontSize="5.6" className="mono" fill="#000" letterSpacing="0.04em">
        {label}
      </text>
      <text x={x + w + 3} y={y + 9} fontSize="5.2" className="mono" fill="#fbbf24" letterSpacing="0.04em">
        ID {id}
      </text>
    </g>
  );
}

export function CameraView({
  timestamp,
  status,
  scene = 'dock-person',
  still = false,
  cam = 'GO2-FRONT',
}: {
  timestamp: string;
  /** Bottom-right overlay, e.g. "Linger 08.2s" or "Clear". */
  status?: string;
  scene?: CameraScene;
  still?: boolean;
  cam?: string;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0c0c0c]">
      <svg viewBox="0 0 320 200" preserveAspectRatio="xMinYMid slice" className="block h-full w-full" aria-hidden>
        <rect width="320" height="78" fill="#0e0e0e" />
        <Ground />

        {scene === 'dock-person' ? (
          <>
            <Fence />
            <DockWall />
            <path d="M232 150 L262 150 L268 160 L226 160 Z" fill="#141414" stroke="#2a2a2a" />
            <Person />
            <Track x={192} y={99} w={30} h={58} label="PERSON 0.94" id="17" />
          </>
        ) : null}

        {scene === 'fence-vehicle' ? (
          <>
            <Fence from={0} to={320} y0={92} slope={10 / 320} height={22} post={14} />
            <Van />
            <Track x={192} y={70} w={80} h={40} label="VEHICLE 0.91" id="4" />
          </>
        ) : null}

        {scene === 'gate-clear' ? (
          <>
            <Fence from={0} to={118} y0={86} slope={6 / 118} height={18} post={12} />
            <Fence from={204} to={320} y0={80} slope={4 / 116} height={18} post={12} />
            <rect x="114" y="52" width="6" height="36" fill="#1c1c1c" stroke="#3a3a3a" />
            <rect x="200" y="50" width="6" height="34" fill="#1c1c1c" stroke="#3a3a3a" />
            <path d="M120 60 L200 58" stroke="#f59e0b" strokeOpacity="0.5" strokeDasharray="4 3" />
            <text x="160" y="54" fontSize="5" className="mono" fill="#525252" textAnchor="middle" letterSpacing="0.08em">
              GATE 1
            </text>
          </>
        ) : null}

        <g stroke="#e5e5e5" strokeOpacity="0.18">
          <path d="M160 94v-8M160 106v8M152 100h-8M168 100h8" />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0">
        {still ? null : <div className="scanline absolute inset-x-0 top-0 h-[10%] border-b border-accent/20" />}
        <div className="mono absolute left-2.5 top-2 text-[9px] uppercase tracking-[0.08em] text-text-muted">CAM · {cam}</div>
        {still ? null : (
          <div className="mono absolute right-2.5 top-2 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] text-accent">
            <span className="blink h-1.5 w-1.5 bg-accent" />
            REC
          </div>
        )}
        <div className="mono tabular absolute bottom-2 left-2.5 text-[9px] tracking-[0.04em] text-text-muted">{timestamp}</div>
        {status ? (
          <div className="mono tabular absolute bottom-2 right-2.5 text-[9px] uppercase tracking-[0.06em] text-accent">{status}</div>
        ) : null}
      </div>
    </div>
  );
}
