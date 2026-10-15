'use client';

/**
 * 3D Circuit & Error Propagation — the third 3D-lab visualizer.
 *
 * WHAT IT SHOWS
 *  1. A 3D perspective circuit board of the SELECTED code's real encoding
 *     circuit (qubit rails in 3D, gates as glowing blocks).
 *  2. REAL error propagation: inject an X / Z / Y error at any qubit and any
 *     point in time, and the Pauli frame is pushed through every Clifford gate
 *     with the exact rules (X through CNOT-control spreads to the target,
 *     Z through CNOT-target spreads to the control, H swaps X ↔ Z). The
 *     glowing pulse rides the rails and splits exactly as the physics says.
 *  3. Below, the same full pipeline circuit the Simulator Lab draws (flat,
 *     large, with a live annotated shot) — "circuit visualization like the
 *     Simulator Lab" directly inside the 3D lab.
 *
 * WHY IT MATTERS: error propagation is WHY quantum error correction needs
 * repeated syndrome rounds — one physical error becomes several after gates.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Play, RotateCcw, FileText, Braces, MousePointer2 } from 'lucide-react';
import { getSVCode, SVCodeDef, SV_CODES } from '@/lib/qec/codes';
import { NoiseModelId, noiseParams } from '@/lib/qec/noise';
import { runTrace } from '@/lib/qec/pipeline';
import { makeRng } from '@/lib/qec/engine';
import { buildFullCircuit, ShotAnnotation } from '@/lib/qec/circuit';
import { Cam, Vec3, useOrbitCam, fitCanvas, dot3D, label3D, stroke3D, bar3D } from './three-d';
import { downloadJSON, downloadCSV, openPrintableReport, runId, nowStamp, TEAM_NAMES } from '@/lib/report';
import CircuitDiagram from './CircuitDiagram';
import { GuideField } from './Guide';

/* ------------------------------------------------------------------ */
/* Pauli-frame propagation (exact Clifford rules)                      */
/* ------------------------------------------------------------------ */

export interface PauliFrame {
  x: boolean[];
  z: boolean[];
}

function cloneFrame(f: PauliFrame): PauliFrame {
  return { x: [...f.x], z: [...f.z] };
}

export function frameLabel(f: PauliFrame): string {
  const parts: string[] = [];
  for (let q = 0; q < f.x.length; q++) {
    const x = f.x[q], z = f.z[q];
    if (x && z) parts.push(`Y@q${q}`);
    else if (x) parts.push(`X@q${q}`);
    else if (z) parts.push(`Z@q${q}`);
  }
  return parts.length ? parts.join(' · ') : 'clean (identity)';
}

/**
 * Push an injected error through the code's encoding circuit, snapshotting
 * the Pauli frame before every gate (frames[k] = errors present at the input
 * of gate k). `injectAt` = inject before gate index injectAt (0 = at the very
 * start, ops.length = at the very end).
 *
 * Exact Clifford conjugation used:
 *   CNOT(c→t):  X_c → X_c·X_t   (x[t] ^= x[c])     X_t → X_t (unchanged)
 *               Z_t → Z_c·Z_t   (z[c] ^= z[t])     Z_c → Z_c (unchanged)
 *   H:          X ↔ Z on that qubit
 */
export function propagateError(code: SVCodeDef, qubit: number, kind: 'X' | 'Z' | 'Y', injectAt: number): PauliFrame[] {
  const n = code.n;
  const f: PauliFrame = { x: Array(n).fill(false), z: Array(n).fill(false) };
  const frames: PauliFrame[] = [];
  const injectX = kind === 'X' || kind === 'Y';
  const injectZ = kind === 'Z' || kind === 'Y';
  const nGates = code.encoding.length;

  code.encoding.forEach((op, gi) => {
    if (gi === injectAt) {
      f.x[qubit] = injectX;
      f.z[qubit] = injectZ;
    }
    if (op.gate === 'CNOT') {
      const [c, t] = op.qubits;
      f.x[t] = f.x[t] !== f.x[c]; // X on the control copies onto the target
      f.z[c] = f.z[c] !== f.z[t]; // Z on the target copies back onto the control
    } else if (op.gate === 'H') {
      const q = op.qubits[0];
      const tmp = f.x[q];
      f.x[q] = f.z[q];
      f.z[q] = tmp;
    }
    frames.push(cloneFrame(f));
  });

  // injection after the LAST gate
  if (injectAt >= nGates) {
    f.x[qubit] = injectX;
    f.z[qubit] = injectZ;
    frames.push(cloneFrame(f));
  }
  return frames;
}

/* ------------------------------------------------------------------ */

const NOISE_LABELS: Record<string, string> = {
  bitflip: 'Bit-Flip (X)',
  phaseflip: 'Phase-Flip (Z)',
  depolarizing: 'Depolarizing',
};

const RAIL_SPACING = 0.52;
const RAIL_HALF = 2.6; // x extent of rails

export function CircuitError3D() {
  const [codeId, setCodeId] = useState('code-3bitflip');
  const [errQubit, setErrQubit] = useState(0);
  const [errKind, setErrKind] = useState<'X' | 'Z' | 'Y'>('X');
  const [injectAt, setInjectAt] = useState(0); // inject before gate index
  const [orbit, setOrbit] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle');
  const [cursor, setCursor] = useState(0); // fractional gate position
  const [flatNoise, setFlatNoise] = useState<NoiseModelId>('bitflip');
  const [flatP, setFlatP] = useState(0.1);
  const [flatSeed, setFlatSeed] = useState(42);
  const [flatTraceRan, setFlatTraceRan] = useState(false);
  const [flatTraceData, setFlatTraceData] = useState<ReturnType<typeof runTrace> | null>(null);

  const code = getSVCode(codeId);
  const nGates = code.encoding.length;

  const frames = useMemo(() => propagateError(code, errQubit, errKind, Math.min(injectAt, nGates)), [code, errQubit, errKind, injectAt, nGates]);
  const finalFrame = frames.length ? frames[frames.length - 1] : { x: Array(code.n).fill(false), z: Array(code.n).fill(false) };

  const rafRef = useRef(0);
  const wakeRef = useRef<() => void>(() => {});
  const phaseRef = useRef(phase);
  const cursorRef = useRef(cursor);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  const orbitRef = useRef(orbit);
  useEffect(() => { orbitRef.current = orbit; }, [orbit]);

  const { cam, canvasRef, setAuto, onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = useOrbitCam(
    { dist: 7.2, yaw: 0.9, pitch: 0.5, auto: true },
    () => wakeRef.current()
  );

  useEffect(() => { setAuto(orbitRef.current); wakeRef.current(); }, [orbit, setAuto]);

  /* gate world positions: each gate gets its own column along x */
  const gateX = useMemo(() => {
    const xs: number[] = [];
    for (let i = 0; i < nGates; i++) xs.push(-RAIL_HALF + ((i + 0.5) / nGates) * 2 * RAIL_HALF);
    return xs;
  }, [nGates]);

  const railY = (q: number) => (q - (code.n - 1) / 2) * RAIL_SPACING;

  /* ---------------- run / reset ---------------- */

  const runPropagate = () => {
    setCursor(0);
    cursorRef.current = 0;
    setPhase('playing');
    phaseRef.current = 'playing';
    wakeRef.current();
  };

  const reset = () => {
    setPhase('idle');
    phaseRef.current = 'idle';
    setCursor(0);
    cursorRef.current = 0;
    wakeRef.current();
  };

  /* animation timer: sweep the cursor over ~2.6 s, then stop (one-shot) */
  useEffect(() => {
    if (phase !== 'playing') return;
    const t0 = performance.now();
    const dur = 2600;
    let raf = 0;
    const tick = () => {
      const frac = Math.min(1, (performance.now() - t0) / dur);
      setCursor(frac);
      cursorRef.current = frac;
      if (frac < 1) raf = requestAnimationFrame(tick);
      else {
        setPhase('done');
        phaseRef.current = 'done';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  /* ---------------- render loop ---------------- */

  useEffect(() => {
    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return false;
      const fit = fitCanvas(cv);
      if (!fit) return false;
      const { w, h, ctx } = fit;
      const camO = cam.current as Cam;
      if (camO.auto) camO.yaw += 0.0016;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.5;
      const scale = Math.min(w / 7.9, h / 5.15);

      // floor grid hint
      ctx.save();
      ctx.strokeStyle = 'rgba(90,80,150,0.16)';
      ctx.lineWidth = 1;
      for (let gx = -RAIL_HALF; gx <= RAIL_HALF + 0.01; gx += RAIL_HALF / 2) {
        stroke3D(ctx, [{ x: gx, y: -(code.n / 2) * RAIL_SPACING - 0.35, z: -0.7 }, { x: gx, y: -(code.n / 2) * RAIL_SPACING - 0.35, z: 0.7 }], camO, cx, cy, scale, 'rgba(90,80,150,0.14)', 1);
      }
      ctx.restore();

      // rails
      for (let q = 0; q < code.n; q++) {
        const y = railY(q);
        stroke3D(ctx, [{ x: -RAIL_HALF - 0.25, y, z: 0 }, { x: RAIL_HALF + 0.25, y, z: 0 }], camO, cx, cy, scale, 'rgba(148,120,220,0.65)', 2);
        label3D(ctx, `q${q}`, { x: -RAIL_HALF - 0.32, y, z: 0 }, camO, cx, cy, scale, '#c4b5fd', '12px ui-monospace, monospace', -30, 4);
      }

      // gates
      code.encoding.forEach((op, gi) => {
        const x = gateX[gi];
        const passed = cursorRef.current * nGates > gi;
        if (op.gate === 'CNOT') {
          const [c, t] = op.qubits;
          const y1 = railY(c), y2 = railY(t);
          stroke3D(ctx, [{ x, y: y1, z: 0 }, { x, y: y2, z: 0 }], camO, cx, cy, scale, passed ? '#67e8f9' : 'rgba(103,232,249,0.5)', passed ? 2.4 : 1.4);
          dot3D(ctx, { x, y: y1, z: 0 }, camO, cx, cy, scale, passed ? '#67e8f9' : 'rgba(103,232,249,0.55)', 4.6, passed ? 11 : 5);
          dot3D(ctx, { x, y: y2, z: 0 }, camO, cx, cy, scale, passed ? '#22d3ee' : 'rgba(34,211,238,0.55)', 6.4, passed ? 13 : 6);
          label3D(ctx, 'CNOT', { x, y: (y1 + y2) / 2, z: 0 }, camO, cx, cy, scale, passed ? '#a5f3fc' : 'rgba(165,243,252,0.55)', '9px ui-sans-serif, system-ui', 7, -2);
        } else if (op.gate === 'H') {
          const q = op.qubits[0];
          bar3D(ctx, { x, z: 0 }, railY(q) - 0.16, railY(q) + 0.16, 0.14, camO, cx, cy, scale, passed ? '#8b5cf6' : '#4c3a80', { outline: passed ? '#c4b5fd' : 'rgba(196,181,253,0.5)' });
          label3D(ctx, 'H', { x, y: railY(q) + 0.34, z: 0 }, camO, cx, cy, scale, passed ? '#ddd6fe' : 'rgba(221,214,254,0.6)', '11px ui-monospace, monospace', -4, 0);
        }
      });

      // error markers — frame state entering the gate at the cursor
      const showFrame = phaseRef.current === 'idle'
        ? (injectAt <= 0 ? frames[0] ?? null : null)
        : frames[Math.min(Math.floor(cursorRef.current * nGates), nGates - 1)] ?? finalFrame;
      if (showFrame) {
        for (let q = 0; q < code.n; q++) {
          const hasX = showFrame.x[q], hasZ = showFrame.z[q];
          if (!hasX && !hasZ) continue;
          const color = hasX && hasZ ? '#e879f9' : hasX ? '#fb7185' : '#fbbf24';
          const y = railY(q);
          dot3D(ctx, { x: -RAIL_HALF - 0.05 + cursorRef.current * 2 * RAIL_HALF, y, z: 0 }, camO, cx, cy, scale, color, 8, 18);
          label3D(ctx, hasX && hasZ ? 'Y' : hasX ? 'X' : 'Z', { x: -RAIL_HALF - 0.05 + cursorRef.current * 2 * RAIL_HALF, y: y + 0.17, z: 0 }, camO, cx, cy, scale, color, 'bold 12px ui-monospace, monospace', 8, -8);
        }
      }

      // final frame halos at output (when done)
      if (phaseRef.current === 'done') {
        for (let q = 0; q < code.n; q++) {
          const hasX = finalFrame.x[q], hasZ = finalFrame.z[q];
          if (!hasX && !hasZ) continue;
          const color = hasX && hasZ ? '#e879f9' : hasX ? '#fb7185' : '#fbbf24';
          dot3D(ctx, { x: RAIL_HALF + 0.3, y: railY(q), z: 0 }, camO, cx, cy, scale, color, 9, 22);
        }
        label3D(ctx, 'output frame', { x: RAIL_HALF + 0.3, y: railY(code.n - 1) + 0.45, z: 0 }, camO, cx, cy, scale, '#94a3b8', '10px ui-sans-serif, system-ui', -30, 0);
      }

      // caption
      ctx.save();
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226,232,240,0.92)';
      const gi = Math.min(Math.floor(cursorRef.current * nGates), nGates - 1);
      ctx.fillText(
        phaseRef.current === 'idle'
          ? `idle — ${errKind} injected on q${errQubit} before gate ${Math.min(injectAt, nGates)} · press Run`
          : phaseRef.current === 'playing'
            ? `propagating… gate ${gi + 1}/${nGates}`
            : `complete — output: ${frameLabel(finalFrame)}`,
        14, 24
      );
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(167,139,250,1)';
      ctx.fillText(`${code.name} encoding circuit · ${nGates} gates — errors SPLIT and MORPH as they cross gates`, 14, 42);
      ctx.restore();

      return phaseRef.current === 'playing' || camO.auto;
    };

    const loop = () => {
      const keep = draw();
      rafRef.current = keep ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };
    wakeRef.current = wake;
    wake();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      wakeRef.current = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, frames, finalFrame, errKind, errQubit, injectAt, nGates]);

  /* ---------------- flat shot circuit (Simulator-Lab style) ---------------- */

  const runFlatShot = () => {
    const t = runTrace(code, flatNoise, noiseParams(flatP, flatNoise), 0, 0, flatSeed, null);
    setFlatTraceData(t);
    setFlatTraceRan(true);
  };

  const fullCircuit = useMemo(
    () => buildFullCircuit(code, flatTraceData?.stateLabel ?? '|0⟩'),
    [code, flatTraceData?.stateLabel]
  );
  const flatAnnotation: ShotAnnotation | null = flatTraceData
    ? {
        noiseEvents: flatTraceData.noiseEvents.map((e) => ({ qubit: e.qubit, kind: e.kind })),
        correction: flatTraceData.correction,
        syndrome: flatTraceData.syndrome.map((s) => s.bit),
        measuredOutcome: flatTraceData.measuredOutcome,
      }
    : null;

  /* ---------------- exports ---------------- */

  const ledger = frames.map((f, i) => ({
    stage: i,
    beforeGate: code.encoding[i]?.gate ?? '—',
    onQubits: code.encoding[i]?.qubits.join(',') ?? '—',
    frame: frameLabel(f),
  }));

  const exportReport = () => {
    openPrintableReport(
      { title: '3D Circuit & Error Propagation Experiment', runKind: '3D Quantum Lab · Error Propagation' },
      [
        {
          heading: 'Inputs',
          kv: [
            ['QEC code', `${code.name} [[${code.n},${code.k},${code.d}]]`],
            ['Injected error', `${errKind} on q${errQubit}`],
            ['Injection point', injectAt <= 0 ? 'before the first encoding gate' : injectAt >= nGates ? 'after the last encoding gate' : `before encoding gate ${injectAt + 1} (${code.encoding[injectAt]?.gate} on q${code.encoding[injectAt]?.qubits.join(',q')})`],
            ['Circuit gates', `${nGates}`],
            ['Generated at', nowStamp()],
          ],
        },
        {
          heading: 'Propagation Ledger — Pauli frame after each gate',
          table: {
            headers: ['After gate', 'Gate', 'Qubits', 'Errors present (Pauli frame)'],
            rows: ledger.map((l) => [String(l.stage + 1), l.beforeGate, l.onQubits, l.frame]),
          },
          note: 'Exact Clifford conjugation rules: X through a CNOT control spreads to the target; Z through a CNOT target spreads back to the control; H swaps X and Z. One small physical error can become several errors — the reason QEC codes need distance and repeated rounds.',
        },
        {
          heading: 'Final Output Frame',
          kv: [['Errors reaching the end of the encoding circuit', frameLabel(finalFrame)]],
        },
        {
          heading: 'Methodology',
          text: `The visualizer pushes the injected Pauli through the ${code.name} encoding circuit using the stabilizer formalism's Clifford conjugation rules, snapshotting the frame before every gate. The 3D view draws the same rails and gates the engine executes. Team: ${TEAM_NAMES.join(', ')}.`,
        },
      ]
    );
  };

  const exportJSONData = () => {
    downloadJSON(`error-propagation-${codeId}-${runId()}.json`, {
      experiment: '3D circuit error propagation',
      generatedAt: nowStamp(),
      team: TEAM_NAMES,
      inputs: { code: codeId, injected: `${errKind}@q${errQubit}`, injectBeforeGate: injectAt },
      ledger,
      finalFrame: frameLabel(finalFrame),
    });
  };

  const exportCSVData = () => {
    downloadCSV(
      `error-propagation-${codeId}-${runId()}.csv`,
      ['after_gate', 'gate', 'qubits', 'pauli_frame'],
      ledger.map((l) => [l.stage + 1, l.beforeGate, l.onQubits, l.frame])
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="glass border-white/8">
          <CardContent className="flex flex-col gap-4 p-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Error Propagation Controls</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Inject one error and watch it split and morph through the real encoding circuit — the physics reason
                error correction needs distance and repeated rounds.
              </p>
            </div>
            <GuideField label="QEC Code" info={{ what: 'Whose encoding circuit the error rides through.', how: 'Pick one — the 3D board rebuilds.', example: 'The Shor Code shows a 12-gate concatenation — spectacular propagation.' }}>
              <Select value={codeId} onValueChange={(v) => { setCodeId(v); setErrQubit((q) => Math.min(q, getSVCode(v).n - 1)); reset(); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SV_CODES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.short} · [[{c.n},{c.k},{c.d}]]</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </GuideField>
            <div className="grid grid-cols-2 gap-2">
              <GuideField label="Error qubit" info={{ what: 'Which qubit receives the injected error.', how: 'Pick any physical qubit.', example: 'q0 is the original data qubit.' }}>
                <Select value={String(errQubit)} onValueChange={(v) => setErrQubit(Number(v))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: code.n }, (_, q) => (
                      <SelectItem key={q} value={String(q)}>q{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </GuideField>
              <GuideField label="Error type" info={{ what: 'X = bit flip, Z = phase flip, Y = both at once.', how: 'Pick one and press Run.', example: 'Y = X and Z together — watch BOTH colors ride the rails.' }}>
                <Select value={errKind} onValueChange={(v) => setErrKind(v as 'X' | 'Z' | 'Y')}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="X">X (bit flip)</SelectItem>
                    <SelectItem value="Z">Z (phase flip)</SelectItem>
                    <SelectItem value="Y">Y (both)</SelectItem>
                  </SelectContent>
                </Select>
              </GuideField>
            </div>
            <GuideField
              label="Injection time"
              info={{ what: 'Where in the circuit the error lands: before gate 1, between gates, or at the very end.', how: 'Drag the slider; gate 1 = start of the encoding circuit.', example: 'Inject before the last CNOT and watch a tiny X become a bigger error.' }}
              right={<span className="font-mono text-violet-300">before gate {Math.min(injectAt, nGates) + 1}</span>}
            >
              <Slider value={[Math.min(injectAt, nGates)]} min={0} max={nGates} step={1} onValueChange={(v) => setInjectAt(v[0])} />
            </GuideField>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-500" onClick={runPropagate}>
                <Play className="mr-1 h-3.5 w-3.5" /> Run
              </Button>
              <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300" onClick={reset}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
              </Button>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400">
              {phase === 'idle' ? 'idle — press Run to propagate' : phase === 'playing' ? 'propagating — watch the pulse split at gates' : 'complete — output frame shown at the right edge'}
            </div>
            {phase === 'done' && (
              <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/[0.06] p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Final errors at circuit output</div>
                <div className="mt-1 font-mono text-xs text-fuchsia-200">{frameLabel(finalFrame)}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300" onClick={exportReport}>
                <FileText className="mr-1 h-3.5 w-3.5" /> Report
              </Button>
              <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300" onClick={exportJSONData}>
                <Braces className="mr-1 h-3.5 w-3.5" /> JSON
              </Button>
              <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300" onClick={exportCSVData}>
                <Braces className="mr-1 h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">Auto-orbit camera</span>
              <Badge variant="outline" className="border-violet-400/40 text-violet-300">3D</Badge>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <MousePointer2 className="h-3 w-3" /> drag to orbit · wheel to zoom
            </span>
          </CardContent>
        </Card>

        <Card className="glass-deep overflow-hidden border-white/8">
          <CardContent className="relative p-2">
            <canvas
              ref={canvasRef}
              className="h-[520px] w-full cursor-grab touch-none rounded-lg active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
            />
            <Badge className="absolute right-4 top-4 bg-violet-600/25 text-violet-200 hover:bg-violet-600/25">3D · live propagation</Badge>
            <div className="pointer-events-none absolute left-4 top-14 flex flex-col gap-1 text-[10px] text-slate-400">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400" />X (bit flip)</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Z (phase flip)</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-fuchsia-400" />Y (both)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* -------- flat shot circuit — same as the Simulator Lab -------- */}
      <Card className="glass border-white/8">
        <CardContent className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Full Pipeline Circuit — same engine as the Simulator Lab</h3>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select value={flatNoise} onValueChange={(v) => setFlatNoise(v as NoiseModelId)}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(NOISE_LABELS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex w-40 items-center gap-2">
                <span className="text-[10px] text-slate-500">p =</span>
                <Slider value={[Math.round(flatP * 100)]} min={0} max={50} step={1} onValueChange={(v) => setFlatP(v[0] / 100)} />
                <span className="font-mono text-[11px] text-violet-300">{flatP.toFixed(2)}</span>
              </div>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-500" onClick={runFlatShot}>
                <Play className="mr-1 h-3.5 w-3.5" /> Run shot
              </Button>
            </div>
          </div>
          {flatTraceRan && flatTraceData ? (
            <>
              <CircuitDiagram circuit={fullCircuit} annotation={flatAnnotation} maxBodyHeight={560} svgId="qec-3d-flat-circuit-svg" />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span>seed {flatSeed} · fidelity {(flatTraceData.fidelity * 100).toFixed(2)}% · outcome |{flatTraceData.measuredOutcome}⟩</span>
                <span className="text-slate-400">{flatTraceData.detectionNote}</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Press <span className="text-violet-300">Run shot</span> — the complete large circuit (input → encode → noise →
              syndrome → correct → decode → measure) draws with the sampled error and decoder corrections annotated, exactly
              like the Simulator Lab.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
