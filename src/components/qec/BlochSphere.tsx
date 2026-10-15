'use client';

/**
 * Lightweight SVG Bloch sphere: wireframe circle, axes, and state vector arrow.
 */

interface Props {
  bloch: { x: number; y: number; z: number };
  size?: number;
  label?: string;
  color?: string;
  ghost?: { x: number; y: number; z: number } | null;
  ghostColor?: string;
}

export default function BlochSphere({ bloch, size = 180, label, color = '#a78bfa', ghost, ghostColor = '#f472b6' }: Props) {
  const c = size / 2;
  const R = size / 2 - 18;

  // iso projection: rotate around vertical axis by 30deg, tilt 20deg
  const yaw = Math.PI / 6;
  const pitch = Math.PI / 7;
  const project = (x: number, y: number, z: number): [number, number, number] => {
    // y = horizontal screen axis, z = vertical (up)
    const x1 = x * Math.cos(yaw) + y * Math.sin(yaw);
    const y1 = -x * Math.sin(yaw) + y * Math.cos(yaw);
    const z1 = z;
    const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch);
    return [x1, y2, z2];
  };
  const toScreen = (p: [number, number, number]): [number, number] => [c + R * p[0], c - R * p[2]];

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const bx = clamp(bloch.x), by = clamp(bloch.y), bz = clamp(bloch.z);
  const tip = toScreen(project(bx, by, bz));
  const depth = project(bx, by, bz)[1]; // positive = behind

  const eq: [number, number][] = [];
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    eq.push(toScreen(project(Math.cos(t), Math.sin(t), 0)));
  }
  const mer1: [number, number][] = [];
  const mer2: [number, number][] = [];
  for (let a = 0; a < 32; a++) {
    const t = (a / 32) * Math.PI * 2;
    mer1.push(toScreen(project(Math.cos(t), 0, Math.sin(t))));
    mer2.push(toScreen(project(0, Math.cos(t), Math.sin(t))));
  }
  const poly = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ');

  const N = toScreen(project(0, 0, 1));
  const S = toScreen(project(0, 0, -1));
  const Xp = toScreen(project(1, 0, 0));
  const Yp = toScreen(project(0, 1, 0));

  const ghostTip = ghost ? toScreen(project(clamp(ghost.x), clamp(ghost.y), clamp(ghost.z))) : null;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} role="img" aria-label={`Bloch sphere ${label ?? ''}`}>
        {/* sphere wireframe */}
        <circle cx={c} cy={c} r={R} fill="#1e1b3a66" stroke="#4c4470" strokeWidth="1" />
        <polygon points={poly(eq)} fill="none" stroke="#4c4470" strokeWidth="0.7" strokeDasharray="3 2" />
        <polygon points={poly(mer1)} fill="none" stroke="#3b3560" strokeWidth="0.6" strokeDasharray="2 3" />
        <polygon points={poly(mer2)} fill="none" stroke="#3b3560" strokeWidth="0.6" strokeDasharray="2 3" />
        {/* axes */}
        <line x1={c} y1={c} x2={N[0]} y2={N[1]} stroke="#5b5480" strokeWidth="0.8" />
        <line x1={c} y1={c} x2={S[0]} y2={S[1]} stroke="#5b5480" strokeWidth="0.8" />
        <line x1={c} y1={c} x2={Xp[0]} y2={Xp[1]} stroke="#5b5480" strokeWidth="0.8" strokeDasharray="2 2" />
        <line x1={c} y1={c} x2={Yp[0]} y2={Yp[1]} stroke="#5b5480" strokeWidth="0.8" strokeDasharray="2 2" />
        <text x={N[0]} y={N[1] - 4} fontSize="9" fill="#8b85ad" textAnchor="middle">|0⟩</text>
        <text x={S[0]} y={S[1] + 10} fontSize="9" fill="#8b85ad" textAnchor="middle">|1⟩</text>
        <text x={Xp[0] + 6} y={Xp[1]} fontSize="9" fill="#8b85ad">|+⟩</text>
        <text x={Yp[0]} y={Yp[1] - 5} fontSize="9" fill="#8b85ad" textAnchor="middle">|i⟩</text>

        {/* ghost (bare qubit) vector */}
        {ghostTip && (
          <line x1={c} y1={c} x2={ghostTip[0]} y2={ghostTip[1]} stroke={ghostColor} strokeWidth="1.6" strokeDasharray="4 3" opacity="0.8" />
        )}

        {/* main vector */}
        <defs>
          <marker id={`arrow-${color.replace('#', '')}`} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill={color} />
          </marker>
        </defs>
        <line
          x1={c} y1={c} x2={tip[0]} y2={tip[1]}
          stroke={color} strokeWidth="2.4" markerEnd={`url(#arrow-${color.replace('#', '')})`}
          opacity={depth > 0 ? 0.75 : 1}
        />
        <circle cx={tip[0]} cy={tip[1]} r="3" fill={color} />
        <circle cx={c} cy={c} r="2.2" fill="#8b85ad" />
      </svg>
      {label && <span className="text-[11px] text-slate-400">{label}</span>}
    </div>
  );
}
