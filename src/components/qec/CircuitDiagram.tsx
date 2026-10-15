'use client';

/**
 * Quantum circuit renderer — "large circuit" edition.
 *
 * TWO modes:
 *  1. FULL PIPELINE (pass `circuit`): renders the complete error-correction
 *     circuit — Input → Encode → Noise (ID slots) → Syndrome (ancilla checks +
 *     measurements) → Correct (conditional decoder boxes) → Decode → Measure —
 *     with stage bands, double classical wires and live-shot annotations.
 *     This mirrors the printed circuit of all_with_noise_prob.py.
 *  2. SIMPLE (pass `ops` + `nQubits`): renders just the given gate list
 *     (used by the Reference gallery for the encoding circuits).
 *
 * The whole SVG is attribute-styled (no CSS classes) so it can be serialized
 * to a PNG with exportCircuitPNG() for the image/PDF exports.
 */

import { FullCircuit, ShotAnnotation, layoutCircuit, CircuitOp } from '@/lib/qec/circuit';
import { GateOp } from '@/lib/qec/codes';

interface Props {
  // full-pipeline mode
  circuit?: FullCircuit;
  annotation?: ShotAnnotation | null;
  // simple mode (gate list, e.g. encoding circuit in the Reference gallery)
  ops?: GateOp[];
  nQubits?: number;
  // display options
  fitWidth?: boolean;              // scale SVG to container width
  maxBodyHeight?: number;          // px, vertical scroll cap
  svgId?: string;                  // id for PNG export
}

/* ---------------- sizing (compact-large cells) ----------------
 * v12 alignment pass: two-line stage headers (title + hint stacked, so a
 * narrow stage can never paint its hint over the next stage's title) with
 * width-aware ellipsis truncation; cell sizes grew slightly (+5-7%) so the
 * layout breathes again while staying clearly more compact than v10. */
const ROW_H = 42;
const CROW_H = 24;
const COL_W = 58;
const LEFT_PAD = 70;
const TOP_PAD = 88;   // stage band area (title line + hint line + gap)
const GATE = 27;      // single-qubit gate box size
const BOTTOM_PAD = 30;

/** Truncate a hint so it fits a pixel budget (~5.0px per char at 9.5px font). */
function fitHint(hint: string, availPx: number): string {
  const maxChars = Math.floor(availPx / 5.0);
  if (hint.length <= maxChars) return hint;
  if (maxChars <= 3) return '…';
  const cut = hint.slice(0, maxChars - 1);
  const sp = cut.lastIndexOf(' ');
  const body = sp >= Math.floor(maxChars * 0.5) ? cut.slice(0, sp) : cut;
  return body.replace(/[\s,]+$/, '') + '…';
}

/* ---------------- palette ---------------- */
const C = {
  dataLine: '#423a6e',
  ancLine: '#2a5560',
  cWire: '#7dd3fc',
  cWireDim: '#334155',
  label: '#8b85ad',
  bandText: '#a5add8',
  separator: '#2e2952',
  fill: '#141126',
  H: { fill: '#2a2350', stroke: '#a78bfa' },
  X: { fill: '#3b1f3b', stroke: '#f472b6' },
  Z: { fill: '#3a2f14', stroke: '#fbbf24' },
  Y: { fill: '#3b1f3b', stroke: '#e879f9' },
  S: { fill: '#233a4a', stroke: '#22d3ee' },
  CNOT: { fill: '#12101f', stroke: '#67e8f9' },
  CZ: { fill: '#12101f', stroke: '#67e8f9' },
  CH: { fill: '#2a2350', stroke: '#a78bfa' },
  prep: { fill: '#312a5e', stroke: '#c4b5fd' },
  id: { fill: '#18202e', stroke: '#5b6b85' },
  meas: { fill: '#0f1526', stroke: '#94a3b8' },
  measFinal: { fill: '#0d2019', stroke: '#34d399' },
  condX: { fill: '#10241a', stroke: '#4ade80' },
  condZ: { fill: '#2a220e', stroke: '#fbbf24' },
};

const STAGE_COLORS: Record<string, string> = {
  input: '#c4b5fd',
  encode: '#a78bfa',
  noise: '#fb7185',
  syndrome: '#22d3ee',
  correct: '#4ade80',
  decode: '#f472b6',
  measure: '#fbbf24',
};

function gateStyle(gate: string): { fill: string; stroke: string } {
  const map = C as unknown as Record<string, { fill: string; stroke: string }>;
  return map[gate] ?? C.H;
}

/* ================================================================== */

export default function CircuitDiagram({ circuit, annotation, ops, nQubits, fitWidth = false, maxBodyHeight = 620, svgId = 'qec-circuit-svg' }: Props) {
  // ---- build the circuit to draw -------------------------------------------
  let fc: FullCircuit;
  if (circuit) {
    fc = circuit;
  } else {
    const enc = (ops ?? []).map((o) => ({ kind: 'gate', gate: o.gate, qubits: [...o.qubits] } as CircuitOp));
    fc = {
      codeId: 'simple',
      codeName: 'Circuit',
      nData: nQubits ?? 1,
      nAnc: 0,
      nClassical: 0,
      stages: [{ key: 'encode', label: 'Encoding', hint: 'gates', ops: enc }],
    };
  }

  const layout = layoutCircuit(fc);
  const rows = layout.rows;
  const width = LEFT_PAD + layout.totalColumns * COL_W + 74;
  const quantumBottom = TOP_PAD + rows * ROW_H;
  const classicalTop = quantumBottom + 26;
  const height = classicalTop + fc.nClassical * CROW_H + BOTTOM_PAD;

  const yOf = (q: number) => TOP_PAD + q * ROW_H;
  const cyOf = (b: number) => classicalTop + b * CROW_H;
  const xOfCol = (col: number) => LEFT_PAD + col * COL_W + COL_W / 2;

  // ---- annotation lookups ----------------------------------------------------
  const noiseByQubit = new Map<number, string>();
  if (annotation?.noiseEvents) for (const e of annotation.noiseEvents) noiseByQubit.set(e.qubit, e.kind);
  const applied = new Set<string>();
  if (annotation?.correction) {
    for (const q of annotation.correction.x) applied.add(`X@${q}`);
    for (const q of annotation.correction.z) applied.add(`Z@${q}`);
  }
  const hasApplied = applied.size > 0;
  const syndromeBits = annotation?.syndrome ?? [];

  return (
    <div
      className="rounded-xl border border-violet-500/25 bg-[#0f0d1c]"
      style={{ maxHeight: maxBodyHeight, overflow: 'auto' }}
    >
      <svg
        id={svgId}
        xmlns="http://www.w3.org/2000/svg"
        width={fitWidth ? '100%' : width}
        height={fitWidth ? undefined : height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={fitWidth ? 'xMinYMin meet' : undefined}
        role="img"
        aria-label="Quantum error correction circuit diagram"
        style={fitWidth ? { display: 'block', height: 'auto' } : { display: 'block' }}
      >
        <rect x={0} y={0} width={width} height={height} fill="#0f0d1c" />

        {/* ---------------- stage bands ---------------- */}
        {layout.stageBands.map((band) => {
          const stage = fc.stages[band.stageIndex];
          if (!stage || stage.ops.length === 0) return null;
          const x1 = LEFT_PAD + band.colFrom * COL_W - 10;
          const x2 = LEFT_PAD + (band.colTo + 1) * COL_W - 6;
          const bandW = Math.max(x2 - x1, 60);
          const color = STAGE_COLORS[stage.key] ?? '#94a3b8';
          // two-line header: title on top, hint below — both clipped to THIS
          // band's width, so adjacent stage headers can never overlap again.
          // the full description is available as a hover tooltip.
          const title = stage.label.toUpperCase();
          const hint = fitHint(stage.short ?? stage.hint, bandW - 22);
          return (
            <g key={`band-${band.stageIndex}`}>
              <title>{`${stage.label} — ${stage.hint}`}</title>
              <rect x={x1} y={8} width={bandW} height={46} rx={8} fill={color} opacity={0.08} />
              <text x={x1 + 11} y={26} fontSize={12} fontWeight={700} fill={color} fontFamily="ui-sans-serif, system-ui">
                {title}
              </text>
              <text x={x1 + 11} y={44} fontSize={9.5} fill="#7c86a8" fontFamily="ui-sans-serif, system-ui">
                {hint}
              </text>
              <line x1={x1} y1={60} x2={x1 + bandW} y2={60} stroke={color} strokeWidth={2} opacity={0.55} />
              {band.stageIndex > 0 && (
                <line x1={x1 - 5} y1={TOP_PAD - 16} x2={x1 - 5} y2={height - 14} stroke={C.separator} strokeWidth={1.4} strokeDasharray="7 6" />
              )}
            </g>
          );
        })}

        {/* ---------------- quantum wires ---------------- */}
        {Array.from({ length: rows }, (_, q) => {
          const isAnc = q >= fc.nData;
          const y = yOf(q);
          const hit = noiseByQubit.has(q);
          return (
            <g key={`row-${q}`}>
              <line x1={LEFT_PAD - 6} y1={y} x2={width - 34} y2={y} stroke={hit ? '#b91c48' : isAnc ? C.ancLine : C.dataLine} strokeWidth={hit ? 2.2 : 1.4} />
              <text x={LEFT_PAD - 10} y={y + 4} fontSize={11.5} fill={isAnc ? '#67e8f9' : '#c4b5fd'} textAnchor="end" fontWeight={700} fontFamily="ui-monospace, monospace">
                {isAnc ? `a${q - fc.nData}` : `q${q}`}
              </text>
              {isAnc && (
                <text x={LEFT_PAD - 10} y={y + 15} fontSize={8} fill="#5d6a86" textAnchor="end" fontFamily="ui-sans-serif, system-ui">
                  ancilla
                </text>
              )}
              {!isAnc && q === 0 && (
                <text x={LEFT_PAD - 10} y={y + 15} fontSize={8} fill="#7c86a8" textAnchor="end" fontFamily="ui-sans-serif, system-ui">
                  data
                </text>
              )}
            </g>
          );
        })}

        {/* ---------------- classical wires (double lines) ---------------- */}
        {fc.nClassical > 0 && (
          <text x={LEFT_PAD - 10} y={classicalTop - 8} fontSize={9.5} fill="#7c86a8" fontFamily="ui-sans-serif, system-ui">
            classical register
          </text>
        )}
        {Array.from({ length: fc.nClassical }, (_, b) => {
          const y = cyOf(b);
          const isFinal = b === fc.nClassical - 1;
          const wireColor = isFinal ? '#34d399' : C.cWire;
          const bitVal = b < syndromeBits.length ? syndromeBits[b] : annotation?.measuredOutcome !== undefined && isFinal ? annotation.measuredOutcome : null;
          return (
            <g key={`cw-${b}`}>
              <line x1={xOfCol(layout.firstMeasureCol) - 14} y1={y - 1.6} x2={width - 34} y2={y - 1.6} stroke={wireColor} strokeWidth={1.1} opacity={0.85} />
              <line x1={xOfCol(layout.firstMeasureCol) - 14} y1={y + 1.6} x2={width - 34} y2={y + 1.6} stroke={wireColor} strokeWidth={1.1} opacity={0.85} />
              <text x={LEFT_PAD - 10} y={y + 3.5} fontSize={10.5} fill={isFinal ? '#6ee7b7' : '#7dd3fc'} textAnchor="end" fontWeight={700} fontFamily="ui-monospace, monospace">
                {isFinal ? 'result' : `s${b}`}
              </text>
              {bitVal !== null && (
                <>
                  <rect x={width - 30} y={y - 9} width={22} height={18} rx={4} fill={Number(bitVal) === 1 ? '#7f1d1d' : '#1e293b'} stroke={Number(bitVal) === 1 ? '#fb7185' : '#475569'} strokeWidth={1.2} />
                  <text x={width - 19} y={y + 4} fontSize={11} fontWeight={700} fill={Number(bitVal) === 1 ? '#fecaca' : '#cbd5e1'} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    {bitVal}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* ---------------- ops ---------------- */}
        {layout.placed.map(({ op, col }, i) => {
          const x = xOfCol(col);
          switch (op.kind) {
            /* ---- state preparation ---- */
            case 'prep': {
              const y = yOf(op.qubit);
              return (
                <g key={`op-${i}`}>
                  <rect x={x - GATE / 2 - 5} y={y - GATE / 2} width={GATE + 10} height={GATE} rx={7} fill={C.prep.fill} stroke={C.prep.stroke} strokeWidth={1.6} />
                  <text x={x} y={y + 4} fontSize={11} fontWeight={700} fill={C.prep.stroke} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    {'|ψ⟩'}
                  </text>
                  <text x={x} y={y + GATE / 2 + 11} fontSize={8} fill="#94a3b8" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
                    {op.label}
                  </text>
                </g>
              );
            }

            /* ---- unitary gates ---- */
            case 'gate': {
              const st = gateStyle(op.gate);
              if (op.gate === 'CNOT' || op.gate === 'CZ' || op.gate === 'CH') {
                const [ctrl, tgt] = op.qubits;
                const y1 = yOf(ctrl), y2 = yOf(tgt);
                return (
                  <g key={`op-${i}`}>
                    <line x1={x} y1={y1} x2={x} y2={y2} stroke={st.stroke} strokeWidth={1.8} />
                    <circle cx={x} cy={y1} r={4.8} fill={st.stroke} />
                    {op.gate === 'CNOT' ? (
                      <g>
                        <circle cx={x} cy={y2} r={9.5} fill={C.fill} stroke={st.stroke} strokeWidth={1.9} />
                        <line x1={x - 9.5} y1={y2} x2={x + 9.5} y2={y2} stroke={st.stroke} strokeWidth={1.9} />
                        <line x1={x} y1={y2 - 9.5} x2={x} y2={y2 + 9.5} stroke={st.stroke} strokeWidth={1.9} />
                      </g>
                    ) : (
                      <g>
                        <rect x={x - 11} y={y2 - 11} width={22} height={22} rx={5} fill={st.fill} stroke={st.stroke} strokeWidth={1.6} />
                        <text x={x} y={y2 + 4.5} fontSize={12} fontWeight={700} fill={st.stroke} textAnchor="middle" fontFamily="ui-monospace, monospace">
                          {op.gate === 'CZ' ? 'Z' : 'H'}
                        </text>
                      </g>
                    )}
                  </g>
                );
              }
              const y = yOf(op.qubits[0]);
              return (
                <g key={`op-${i}`}>
                  <rect x={x - GATE / 2} y={y - GATE / 2} width={GATE} height={GATE} rx={7} fill={st.fill} stroke={st.stroke} strokeWidth={1.7} />
                  <text x={x} y={y + 4.5} fontSize={12} fontWeight={700} fill={st.stroke} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    {op.gate}
                  </text>
                </g>
              );
            }

            /* ---- noise slot (ID gate) ---- */
            case 'id': {
              const y = yOf(op.qubit);
              const err = noiseByQubit.get(op.qubit);
              const color = err ? (err === 'Z' ? C.Z.stroke : err === 'Y' ? C.Y.stroke : C.X.stroke) : C.id.stroke;
              return (
                <g key={`op-${i}`}>
                  <rect
                    x={x - GATE / 2}
                    y={y - GATE / 2}
                    width={GATE}
                    height={GATE}
                    rx={7}
                    fill={err ? (err === 'Z' ? '#2a220e' : err === 'Y' ? '#311533' : '#31121c') : C.id.fill}
                    stroke={color}
                    strokeWidth={err ? 2.2 : 1.3}
                    strokeDasharray={err ? undefined : '4 3'}
                  />
                  <text x={x} y={y + 4} fontSize={11} fontWeight={700} fill={err ? color : '#64748b'} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    ID
                  </text>
                  {err ? (
                    <>
                      <path d={`M ${x + GATE / 2 + 3} ${y - 9} l 6 6 l -4 2 l 7 7`} stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" />
                      <text x={x + GATE / 2 + 13} y={y + 4} fontSize={10} fontWeight={700} fill={color} fontFamily="ui-monospace, monospace">
                        {err}
                      </text>
                      <text x={x} y={y + GATE / 2 + 11} fontSize={8} fill={color} textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
                        error hit
                      </text>
                    </>
                  ) : (
                    <text x={x} y={y + GATE / 2 + 11} fontSize={8} fill="#475569" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
                      noise slot
                    </text>
                  )}
                </g>
              );
            }

            /* ---- ancilla measurement ---- */
            case 'measure': {
              const y = yOf(op.qubit);
              const wy = cyOf(op.cbit);
              return (
                <g key={`op-${i}`}>
                  <rect x={x - GATE / 2} y={y - GATE / 2} width={GATE} height={GATE} rx={7} fill={C.meas.fill} stroke={C.meas.stroke} strokeWidth={1.6} />
                  <path d={`M ${x - 9} ${y + 6} A 10 10 0 0 1 ${x + 9} ${y + 6}`} fill="none" stroke={C.meas.stroke} strokeWidth={1.5} />
                  <line x1={x} y1={y + 6} x2={x + 5} y2={y - 5} stroke={C.meas.stroke} strokeWidth={1.5} />
                  <line x1={x} y1={y + GATE / 2} x2={x} y2={wy - 4} stroke={C.meas.stroke} strokeWidth={1.4} />
                  <path d={`M ${x - 3.4} ${wy - 6.5} L ${x} ${wy - 2} L ${x + 3.4} ${wy - 6.5} Z`} fill={C.meas.stroke} />
                  {syndromeBits[op.cbit] !== undefined && (
                    <text x={x} y={y - GATE / 2 - 5} fontSize={9} fontWeight={700} fill={syndromeBits[op.cbit] === 1 ? '#fb7185' : '#64748b'} textAnchor="middle" fontFamily="ui-monospace, monospace">
                      {syndromeBits[op.cbit] === 1 ? '−1' : '+1'}
                    </text>
                  )}
                </g>
              );
            }

            /* ---- conditional correction ---- */
            case 'cond': {
              const y = yOf(op.qubit);
              const key = `${op.gate}@${op.qubit}`;
              const isApplied = applied.has(key);
              const st = op.gate === 'X' ? C.condX : C.condZ;
              const shortSyndrome = op.syndrome.length > 6 ? op.syndrome.slice(0, 6) + '…' : op.syndrome;
              const wy = classicalTop - 4;
              return (
                <g key={`op-${i}`} opacity={hasApplied && !isApplied ? 0.4 : 1}>
                  {isApplied && (
                    <line x1={x} y1={y + GATE / 2} x2={x} y2={wy} stroke={st.stroke} strokeWidth={1.3} strokeDasharray="4 3" />
                  )}
                  <rect
                    x={x - GATE / 2}
                    y={y - GATE / 2}
                    width={GATE}
                    height={GATE}
                    rx={7}
                    fill={st.fill}
                    stroke={st.stroke}
                    strokeWidth={isApplied ? 2.6 : 1.4}
                    strokeDasharray="5 3"
                  />
                  <text x={x} y={y + 4.5} fontSize={12} fontWeight={700} fill={st.stroke} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    {op.gate}
                  </text>
                  <text x={x} y={y + GATE / 2 + 11} fontSize={8} fill={st.stroke} textAnchor="middle" fontFamily="ui-monospace, monospace">
                    if s={shortSyndrome}
                  </text>
                  {isApplied && (
                    <text x={x} y={y - GATE / 2 - 5} fontSize={9} fontWeight={700} fill="#4ade80" textAnchor="middle" fontFamily="ui-sans-serif, system-ui">
                      applied
                    </text>
                  )}
                </g>
              );
            }

            /* ---- final measurement ---- */
            case 'measureFinal': {
              const y = yOf(op.qubit);
              const wy = cyOf(op.cbit);
              const outcome = annotation?.measuredOutcome;
              return (
                <g key={`op-${i}`}>
                  <rect x={x - GATE / 2} y={y - GATE / 2} width={GATE} height={GATE} rx={7} fill={C.measFinal.fill} stroke={C.measFinal.stroke} strokeWidth={2} />
                  <path d={`M ${x - 9} ${y + 6} A 10 10 0 0 1 ${x + 9} ${y + 6}`} fill="none" stroke={C.measFinal.stroke} strokeWidth={1.6} />
                  <line x1={x} y1={y + 6} x2={x + 5} y2={y - 5} stroke={C.measFinal.stroke} strokeWidth={1.6} />
                  <line x1={x} y1={y + GATE / 2} x2={x} y2={wy - 4} stroke={C.measFinal.stroke} strokeWidth={1.5} />
                  <path d={`M ${x - 3.4} ${wy - 6.5} L ${x} ${wy - 2} L ${x + 3.4} ${wy - 6.5} Z`} fill={C.measFinal.stroke} />
                  {outcome !== undefined && (
                    <text x={x} y={y - GATE / 2 - 5} fontSize={10} fontWeight={700} fill="#34d399" textAnchor="middle" fontFamily="ui-monospace, monospace">
                      |{outcome}⟩
                    </text>
                  )}
                </g>
              );
            }

            default:
              return null;
          }
        })}
      </svg>
    </div>
  );
}

/* ================================================================== */
/* PNG export — serializes the attribute-styled SVG into a PNG download */
/* or a data URL (for embedding into the printable PDF report).         */
/* ================================================================== */

function svgToPngCanvas(svg: SVGSVGElement, scale: number, background: string): HTMLCanvasElement | null {
  const w = svg.viewBox.baseVal?.width || svg.clientWidth || 1200;
  const h = svg.viewBox.baseVal?.height || svg.clientHeight || 700;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  // drawImage with an SVG image source is synchronous AFTER load; we use a
  // data URL so the decode happens quickly — callers await the promise API.
  img.setAttribute('src', svg64);
  // attempt sync draw (works in Chromium for data-URL SVGs that are cached)
  try {
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    // verify the canvas actually got pixels (draw may be a no-op if not loaded)
    const probe = ctx.getImageData(Math.round(cv.width / 2), Math.round(cv.height / 2), 1, 1).data;
    if (probe[3] === 0 || (probe[0] === 15 && probe[1] === 13 && probe[2] === 28)) {
      return null; // likely not drawn yet — caller must use the async path
    }
    return cv;
  } catch {
    return null;
  }
}

export function svgToPngDataUrl(svgId: string, scale = 2, background = '#0f0d1c'): Promise<string | null> {
  return new Promise((resolve) => {
    const svg = document.getElementById(svgId) as SVGSVGElement | null;
    if (!svg) return resolve(null);

    // fast path: synchronous draw (Chromium usually hits this)
    const fast = svgToPngCanvas(svg, scale, background);
    if (fast) return resolve(fast.toDataURL('image/png'));

    // reliable async path
    const w = svg.viewBox.baseVal?.width || svg.clientWidth || 1200;
    const h = svg.viewBox.baseVal?.height || svg.clientHeight || 700;
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale);
      cv.height = Math.round(h * scale);
      const ctx = cv.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = svg64;
  });
}

export async function exportCircuitPNG(svgId: string, filename: string, scale = 2, background = '#0f0d1c') {
  const dataUrl = await svgToPngDataUrl(svgId, scale, background);
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
