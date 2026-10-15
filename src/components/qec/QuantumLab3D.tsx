'use client';

/**
 * Quantum Lab 3D — the real-time Bloch-sphere suite.
 *
 * SCOPE — every visualizer here is a live view of the SAME project pipeline
 * (bit-flip, phase-flip, Shor × three noise channels of all_with_noise_prob.py), rendered
 * on and around the Bloch sphere, driven by the verified state-vector engine:
 *
 *   1. Bloch Sphere — an interactive stage-by-stage walkthrough of the full
 *      error-correction pipeline (Input → Encode → Noise → Syndrome → Correct
 *      → Decode → Measure). The state arrow moves on the sphere in real time
 *      as each stage executes for real.
 *
 *   2. Bloch Flight 4D — a logical qubit flying round after round through
 *      noise + correction cycles, with its time-colored trajectory trail
 *      (space + time = 4D) and the bare-qubit ghost for comparison.
 *
 * Every visualizer is a one-shot run (press Run, it plays through, stops) and
 * exports a formal report, JSON and per-stage/per-round CSV data.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Play, RotateCcw, FileText, Braces, MousePointer2, Orbit, Globe, ChevronLeft, ChevronRight, FlaskConical, Workflow } from 'lucide-react';
import { makeRng, StateVector, RNG, GATES } from '@/lib/qec/engine';
import { getSVCode, SVCodeDef, SV_CODES } from '@/lib/qec/codes';
import { NoiseModelId, NoiseParams, noiseParams, applyNoiseLayer } from '@/lib/qec/noise';
import { prepareEncodedState, runLiveRound, runBareRound } from '@/lib/qec/pipeline';
import { fidelityFromRho, blochFromRho, lookupCorrection } from '@/lib/qec/codes';
import { Cam, Vec3, useOrbitCam, fitCanvas, drawWireSphere, drawArrow3D, dot3D, label3D, stroke3D } from './three-d';
import { CircuitError3D } from './CircuitError3D';
import { downloadJSON, downloadCSV, openPrintableReport, runId, nowStamp, TEAM_NAMES } from '@/lib/report';
import { GuideField } from './Guide';

const NOISE_LABELS: Record<string, string> = {
  bitflip: 'Bit-Flip (X)',
  phaseflip: 'Phase-Flip (Z)',
  depolarizing: 'Depolarizing',
};

const STATE_PRESETS = [
  { label: '|0⟩', theta: 0, phi: 0 },
  { label: '|1⟩', theta: Math.PI, phi: 0 },
  { label: '|+⟩', theta: Math.PI / 2, phi: 0 },
  { label: '|+i⟩', theta: Math.PI / 2, phi: Math.PI / 2 },
  { label: 'Custom', theta: -1, phi: -1 },
];

function StatChip({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-200';
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function ExportRow({ onReport, onJSON, onCSV }: { onReport: () => void; onJSON: () => void; onCSV: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10" onClick={onReport}>
        <FileText className="mr-1 h-3.5 w-3.5" /> Report
      </Button>
      <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10" onClick={onJSON}>
        <Braces className="mr-1 h-3.5 w-3.5" /> JSON
      </Button>
      <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10" onClick={onCSV}>
        <Braces className="mr-1 h-3.5 w-3.5" /> CSV
      </Button>
    </div>
  );
}

/* ==================================================================== */
/* Bloch Sphere — interactive pipeline walkthrough                       */
/* ==================================================================== */

interface StageSnap {
  key: string;
  title: string;
  desc: string;
  vec: Vec3;
  syndrome?: { label: string; bit: number }[];
  correction?: { x: number[]; z: number[] };
  fidelity?: number;
  events?: string[];
  outcome?: 0 | 1;
  detail?: string;
}

const STAGE_ORDER = ['input', 'encode', 'noise', 'syndrome', 'correct', 'decode', 'measure'] as const;

/** Decode a CLONE of the encoded state and return its logical Bloch vector (non-destructive, canvas coords). */
function readoutBloch(sv: StateVector, code: SVCodeDef): Vec3 {
  const clone = sv.clone();
  for (const op of code.decoding) clone.applyGateOp(op.gate, op.qubits, op.param);
  const rho = clone.partialTraceQ0();
  return toCanvasBloch(blochFromRho(rho));
}

const toVec3 = (theta: number, phi: number): Vec3 => ({
  x: Math.sin(theta) * Math.cos(phi),
  y: Math.cos(theta),
  z: Math.sin(theta) * Math.sin(phi),
});

/**
 * Engine Bloch vector (physics convention: z = population |0>/|1> axis)
 * -> canvas coordinates (three-d: y = vertical). |0> up, |+> right, |+i> front.
 */
const toCanvasBloch = (b: { x: number; y: number; z: number }): Vec3 => ({
  x: b.x,
  y: b.z,
  z: b.y,
});

export function BlochSphereWalkthrough() {
  const [codeId, setCodeId] = useState('code-3bitflip');
  const [noise, setNoise] = useState<NoiseModelId>('bitflip');
  const [p, setP] = useState(0.1);
  const [theta, setTheta] = useState(0);
  const [phi, setPhi] = useState(0);
  const [preset, setPreset] = useState('|0⟩');
  const [manualMode, setManualMode] = useState(false);
  const [errQubit, setErrQubit] = useState(1);
  const [errKind, setErrKind] = useState<'X' | 'Z' | 'Y'>('X');
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle');
  const [stageIdx, setStageIdx] = useState(0);
  const [snaps, setSnaps] = useState<StageSnap[]>([]);
  const [orbit, setOrbit] = useState(true);

  const rafRef = useRef(0);
  const wakeRef = useRef<() => void>(() => {});
  const phaseRef = useRef<'idle' | 'playing' | 'done'>('idle');
  const stageRef = useRef(0);
  const targetRef = useRef<Vec3>({ x: 0, y: 1, z: 0 });
  const dispRef = useRef<Vec3>({ x: 0, y: 1, z: 0 });
  const lastRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapsRef = useRef<StageSnap[]>([]);
  const orbitRef = useRef(orbit);
  useEffect(() => { orbitRef.current = orbit; }, [orbit]);

  const { cam, canvasRef, setAuto, onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = useOrbitCam(
    { dist: 3.1, yaw: 0.55, pitch: 0.4, auto: true },
    () => wakeRef.current()
  );

  const cfgRef = useRef({ codeId, noise, p, theta, phi, manualMode, errQubit, errKind });
  useEffect(() => {
    cfgRef.current = { codeId, noise, p, theta, phi, manualMode, errQubit, errKind };
  }, [codeId, noise, p, theta, phi, manualMode, errQubit, errKind]);

  /* ---------------- run the REAL pipeline once, capturing every stage --------------- */

  const runPipeline = () => {
    const c = cfgRef.current;
    const code = getSVCode(c.codeId);
    const params: NoiseParams = noiseParams(c.p, c.noise);
    const rng: RNG = makeRng(Math.floor(Math.random() * 1e9));
    const captured: StageSnap[] = [];

    // Stage 0 — INPUT
    const inputVec = toVec3(c.theta, c.phi);
    captured.push({
      key: 'input', title: 'Input |ψ⟩',
      desc: `The logical qubit starts at θ = ${c.theta.toFixed(2)} rad, φ = ${c.phi.toFixed(2)} rad on the Bloch sphere.`,
      vec: inputVec,
    });

    // Stage 1 — ENCODE (real encoding circuit on the engine state vector)
    const sv = new StateVector(code.n);
    sv.prepareQubit0(c.theta, c.phi);
    for (const op of code.encoding) sv.applyGateOp(op.gate, op.qubits, op.param);
    captured.push({
      key: 'encode', title: 'Encode',
      desc: `CNOTs spread |ψ⟩ across ${code.n} physical qubits (α|000⟩ + β|111⟩ for the repetition family). The LOGICAL arrow stays exactly where it was — encoding copies protection, not the state itself.`,
      vec: inputVec,
      detail: `Encoded block: ${sv.topAmplitudes(0.008, 4).map((a) => `${a.label} (${(a.prob * 100).toFixed(0)}%)`).join(' · ')}`,
    });

    // Stage 2 — NOISE (real channel sampling or manual injection)
    let events: { kind: string; qubit: number }[] = [];
    if (c.manualMode) {
      const x = c.errKind === 'X' || c.errKind === 'Y';
      const z = c.errKind === 'Z' || c.errKind === 'Y';
      if (x) sv.applyGate1(c.errQubit, GATES.X);
      if (z) sv.applyGate1(c.errQubit, GATES.Z);
      events = [
        ...(x ? [{ kind: 'X', qubit: c.errQubit }] : []),
        ...(z ? [{ kind: 'Z', qubit: c.errQubit }] : []),
      ];
    } else {
      events = applyNoiseLayer(sv, c.noise, params, rng).map((e) => ({ kind: e.kind, qubit: e.qubit }));
    }
    const noiseVec = readoutBloch(sv, code);
    captured.push({
      key: 'noise', title: 'Noise',
      desc: events.length
        ? `${NOISE_LABELS[c.noise]} hit: ${events.map((e) => `${e.kind} on q${e.qubit}`).join(', ')}. Watch the arrow jump away from its target.`
        : `No error sampled this shot (p = ${c.p.toFixed(2)} per qubit). The arrow stays put — not every shot is hit.`,
      vec: noiseVec,
      events: events.map((e) => `${e.kind}@q${e.qubit}`),
    });

    // Stage 3 — SYNDROME (real projective stabilizer measurements)
    const syndrome: { label: string; bit: number }[] = [];
    for (const st of code.stabilizers) {
      const { outcome } = sv.measurePauli(st.paulis, rng, false);
      syndrome.push({ label: st.label, bit: outcome === -1 ? 1 : 0 });
    }
    captured.push({
      key: 'syndrome', title: 'Syndrome',
      desc: syndrome.some((s) => s.bit)
        ? `Defects: ${syndrome.filter((s) => s.bit).map((s) => `${s.label}=1`).join(', ')} — the parity checks located the error WITHOUT reading the data.`
        : 'All checks +1 (trivial syndrome) — nothing to correct.',
      vec: noiseVec,
      syndrome,
    });

    // Stage 4 — CORRECT (real decoder lookup + recovery gates)
    const bits = syndrome.map((s) => s.bit);
    let correction = { x: [] as number[], z: [] as number[] };
    if (bits.some((b) => b === 1)) {
      correction = lookupCorrection(code, bits);
      for (const q of correction.x) sv.applyGate1(q, GATES.X);
      for (const q of correction.z) sv.applyGate1(q, GATES.Z);
    }
    const correctedVec = readoutBloch(sv, code);
    captured.push({
      key: 'correct', title: 'Correct',
      desc: correction.x.length || correction.z.length
        ? `Decoder applied ${correction.x.length ? `X on q${correction.x.join(', q')}` : ''}${correction.x.length && correction.z.length ? ' and ' : ''}${correction.z.length ? `Z on q${correction.z.join(', q')}` : ''}. The arrow snaps back toward its target.`
        : 'No correction needed this shot.',
      vec: correctedVec,
      correction,
    });

    // Stage 5 — DECODE (real inverse circuit + fidelity)
    const clone = sv.clone();
    for (const op of code.decoding) clone.applyGateOp(op.gate, op.qubits);
    const rho = clone.partialTraceQ0();
    const fidelity = fidelityFromRho(rho, c.theta, c.phi);
    const decodedVec = toCanvasBloch(blochFromRho(rho));
    captured.push({
      key: 'decode', title: 'Decode',
      desc: `The inverse circuit un-encodes to one qubit. Fidelity with the requested |ψ⟩: ${(fidelity * 100).toFixed(2)}%.`,
      vec: decodedVec,
      fidelity,
    });

    // Stage 6 — MEASURE
    const outcome: 0 | 1 = rng() < rho[6] ? 1 : 0;
    captured.push({
      key: 'measure', title: 'Measure',
      desc: `Final readout: |${outcome}⟩ — ${outcome === (c.theta < Math.PI / 2 ? 0 : 1) ? 'matches the dominant amplitude of your input state.' : 'the minority outcome won this sampling — re-run to see the statistics.'} Fidelity ${(fidelity * 100).toFixed(2)}% is the real quality number.`,
      vec: decodedVec,
      fidelity,
      outcome,
    });

    snapsRef.current = captured;
    setSnaps(captured);
    stageRef.current = 0;
    setStageIdx(0);
    targetRef.current = captured[0].vec;
    dispRef.current = { ...captured[0].vec };
    phaseRef.current = 'playing';
    setPhase('playing');
    wakeRef.current();
  };

  /* ---------------- auto-play timer: one stage per 1.7 s, then stop --------------- */

  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => {
      const next = stageRef.current + 1;
      if (next >= snapsRef.current.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        phaseRef.current = 'done';
        setPhase('done');
        return;
      }
      stageRef.current = next;
      setStageIdx(next);
      targetRef.current = snapsRef.current[next].vec;
      wakeRef.current();
    }, 1700);
    timerRef.current = t;
    return () => {
      clearInterval(t);
      timerRef.current = null;
    };
  }, [phase]);

  /* ---------------- render loop (orbit camera + eased arrow) --------------- */

  useEffect(() => {
    lastRef.current = performance.now();

    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return false;
      const fit = fitCanvas(cv);
      if (!fit) return false;
      const { w, h, ctx } = fit;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      const camO = cam.current as Cam;
      if (camO.auto) camO.yaw += dt * 0.12;

      // eased arrow
      const ease = 1 - Math.exp(-dt * 5);
      dispRef.current = {
        x: dispRef.current.x + (targetRef.current.x - dispRef.current.x) * ease,
        y: dispRef.current.y + (targetRef.current.y - dispRef.current.y) * ease,
        z: dispRef.current.z + (targetRef.current.z - dispRef.current.z) * ease,
      };

      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.48;
      const scale = Math.min(w, h) * 0.36;

      drawWireSphere(ctx, camO, cx, cy, scale, 'rgba(134,126,205,0.62)');

      // axes
      const axes: { v: Vec3; label: string }[] = [
        { v: { x: 0, y: 1.18, z: 0 }, label: '|0⟩' },
        { v: { x: 0, y: -1.18, z: 0 }, label: '|1⟩' },
        { v: { x: 1.2, y: 0, z: 0 }, label: '|+⟩' },
        { v: { x: -1.2, y: 0, z: 0 }, label: '|−⟩' },
        { v: { x: 0, y: 0, z: 1.2 }, label: '|+i⟩' },
        { v: { x: 0, y: 0, z: -1.2 }, label: '|−i⟩' },
      ];
      for (const ax of axes) {
        stroke3D(ctx, [{ x: 0, y: 0, z: 0 }, ax.v], camO, cx, cy, scale, 'rgba(100,90,150,0.4)', 0.8, [3, 3]);
        label3D(ctx, ax.label, ax.v, camO, cx, cy, scale, '#8b85ad', '10px monospace', 0, 0);
      }

      // input target pin
      const c = cfgRef.current;
      const target = toVec3(c.theta, c.phi);
      dot3D(ctx, target, camO, cx, cy, scale, 'rgba(103,232,249,0.28)', 9, 0);
      dot3D(ctx, target, camO, cx, cy, scale, 'rgba(103,232,249,0.95)', 3, 10);
      label3D(ctx, 'target |ψ⟩', { x: target.x * 1.16, y: target.y * 1.16, z: target.z * 1.16 }, camO, cx, cy, scale, 'rgba(103,232,249,0.95)', '10px ui-sans-serif', 6, -6);

      // the state arrow
      drawArrow3D(ctx, dispRef.current, camO, cx, cy, scale, '#a78bfa', 3.2);

      // stage caption on canvas
      const s = snapsRef.current[stageRef.current];
      ctx.save();
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(226,232,240,0.92)';
      if (s) ctx.fillText(`stage ${STAGE_ORDER.indexOf(s.key as (typeof STAGE_ORDER)[number]) + 1}/7 · ${s.title}`, 14, 24);
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(167,139,250,1)';
      ctx.fillText('— logical qubit state (live)', 14, 42);
      ctx.restore();

      const settled =
        Math.abs(dispRef.current.x - targetRef.current.x) < 0.004 &&
        Math.abs(dispRef.current.y - targetRef.current.y) < 0.004 &&
        Math.abs(dispRef.current.z - targetRef.current.z) < 0.004;
      return phaseRef.current === 'playing' || !settled || camO.auto;
    };

    const loop = () => {
      const keep = draw();
      rafRef.current = keep ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (!rafRef.current) {
        lastRef.current = performance.now();
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    wakeRef.current = wake;
    wake();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      wakeRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    setAuto(orbitRef.current);
    wakeRef.current();
  }, [orbit, setAuto]);

  const applyPreset = (label: string) => {
    const pr = STATE_PRESETS.find((s) => s.label === label);
    if (!pr) return;
    setPreset(label);
    if (pr.theta >= 0) {
      setTheta(pr.theta);
      setPhi(pr.phi);
      const v = toVec3(pr.theta, pr.phi);
      targetRef.current = { ...v };
      dispRef.current = { ...v };
      wakeRef.current();
    }
  };

  /** switch code + reset everything (event handler — no setState-in-effect) */
  const switchCode = (id: string) => {
    setCodeId(id);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    phaseRef.current = 'idle';
    setPhase('idle');
    stageRef.current = 0;
    setStageIdx(0);
    snapsRef.current = [];
    setSnaps([]);
    if (errQubit > getSVCode(id).n - 1) setErrQubit(0);
    const v = toVec3(theta, phi);
    targetRef.current = { ...v };
    dispRef.current = { ...v };
    wakeRef.current();
  };

  const goStage = (i: number) => {
    if (!snapsRef.current.length) return;
    const clamped = Math.max(0, Math.min(snapsRef.current.length - 1, i));
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    phaseRef.current = 'done';
    setPhase('done');
    stageRef.current = clamped;
    setStageIdx(clamped);
    targetRef.current = snapsRef.current[clamped].vec;
    wakeRef.current();
  };

  const reset = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    phaseRef.current = 'idle';
    setPhase('idle');
    stageRef.current = 0;
    setStageIdx(0);
    snapsRef.current = [];
    setSnaps([]);
    const c = cfgRef.current;
    const v = toVec3(c.theta, c.phi);
    targetRef.current = { ...v };
    dispRef.current = { ...v };
    wakeRef.current();
  };

  const code = getSVCode(codeId);
  const cur = snaps[Math.min(stageIdx, Math.max(snaps.length - 1, 0))];

  const exportReport = () => {
    openPrintableReport(
      { title: 'Bloch Sphere — Pipeline Walkthrough Experiment', runKind: 'Real-Time 3D Visualizer' },
      [
        {
          heading: 'Inputs',
          kv: [
            ['QEC code', `${code.name} [[${code.n},${code.k},${code.d}]]`],
            ['Noise model', NOISE_LABELS[noise] ?? noise],
            ['Noise strength p', p.toFixed(3)],
            ['Input state', preset === 'Custom' ? `θ = ${theta.toFixed(2)} rad, φ = ${phi.toFixed(2)} rad` : preset],
            ['Error mode', manualMode ? `Manual — ${errKind} on q${errQubit}` : 'Random sampling (seeded)'],
            ['Generated at', nowStamp()],
          ],
        },
        {
          heading: 'Stage Ledger (this run)',
          table: {
            headers: ['Stage', 'What happened', 'Fidelity'],
            rows: snaps.map((s) => [
              s.title,
              s.events?.length ? `events: ${s.events.join(' ')}` : s.desc.slice(0, 90),
              s.fidelity !== undefined ? (s.fidelity * 100).toFixed(2) + '%' : '—',
            ]),
          },
          note: 'Every stage executed against the real state-vector engine — encoding circuit, quantum-trajectory noise sampling, projective stabilizer measurement, decoder lookup, inverse-circuit decoding and Z-basis readout.',
        },
        {
          heading: 'Methodology',
          text: `The sphere shows the LOGICAL Bloch vector, recomputed non-destructively at each stage by decoding a clone of the encoded state (partial trace onto the data qubit). The full pipeline matches all_with_noise_prob.py: encode → noise on every qubit → syndrome → correction → decode → measure. Team: ${TEAM_NAMES.join(', ')}.`,
        },
      ]
    );
  };

  const exportJSONData = () => {
    downloadJSON(`bloch-sphere-walkthrough-${codeId}-${runId()}.json`, {
      experiment: 'Bloch Sphere — QEC pipeline walkthrough',
      generatedAt: nowStamp(),
      team: TEAM_NAMES,
      inputs: { code: codeId, noise, p, theta, phi, manualMode, errQubit: manualMode ? errQubit : null, errKind: manualMode ? errKind : null },
      stages: snaps,
    });
  };

  const exportCSVData = () => {
    downloadCSV(
      `bloch-sphere-walkthrough-${codeId}-${runId()}.csv`,
      ['stage', 'x', 'y', 'z', 'fidelity', 'events'],
      snaps.map((s) => [s.title, s.vec.x.toFixed(6), s.vec.y.toFixed(6), s.vec.z.toFixed(6), s.fidelity !== undefined ? s.fidelity.toFixed(6) : '', (s.events ?? []).join(' ')])
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <Card className="glass border-white/8">
        <CardContent className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Bloch Sphere Controls</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Walk the FULL error-correction pipeline stage by stage — every stage really executes on the engine, and the
              arrow shows the live logical state.
            </p>
          </div>
          <GuideField label="QEC Code" info={{ what: 'Which of the two project codes protects the qubit.', how: 'Pick one — the sphere resets and re-encodes.', example: '3-Qubit Bit-Flip fixes a single X error; Phase-Flip fixes a single Z error.' }}>
            <Select value={codeId} onValueChange={switchCode}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SV_CODES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.short} · [[{c.n},{c.k},{c.d}]]</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </GuideField>
          <GuideField label="Noise Model" info={{ what: 'The channel applied at the Noise stage — the same three implemented in all_with_noise_prob.py.', how: 'Pick one; p sets how hard it hits.', example: 'Bit-Flip (X) at 10% flips one qubit roughly every tenth shot.' }}>
            <Select value={noise} onValueChange={(v) => setNoise(v as NoiseModelId)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NOISE_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </GuideField>
          <GuideField label="Noise strength p" info={{ what: 'Per-qubit probability that the noise hits during the Noise stage.', how: 'Drag 0–50%. 10% is the classic starting point.', example: 'p = 0.10, 3 qubits → ~27% of shots get at least one error.' }} right={<span className="font-mono text-violet-300">{p.toFixed(3)}</span>}>
            <Slider value={[Math.round(p * 500)]} min={0} max={250} step={1} onValueChange={(v) => setP(v[0] / 500)} />
          </GuideField>
          <GuideField label="Input State |ψ⟩" info={{ what: 'Where the arrow starts on the sphere.', how: 'Click a preset or pick Custom and use the sliders below.', example: '|+⟩ sits on the equator — both 0 and 1 in equal mix.' }}>
            <div className="flex flex-wrap gap-1.5">
              {STATE_PRESETS.map((s) => (
                <Button
                  key={s.label}
                  size="sm"
                  variant={preset === s.label ? 'default' : 'outline'}
                  className={preset === s.label ? 'bg-violet-600 hover:bg-violet-500' : 'border-violet-400/30 bg-white/[0.03] text-slate-300'}
                  onClick={() => applyPreset(s.label)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </GuideField>
          {preset === 'Custom' && (
            <>
              <GuideField label="θ polar" info={{ what: 'Angle from the |0⟩ pole.', how: 'Drag to set the |0⟩/|1⟩ mix.', example: 'θ = π/2 → equator.' }} right={<span className="font-mono text-violet-300">{theta.toFixed(2)} rad</span>}>
                <Slider value={[Math.round((theta / Math.PI) * 100)]} min={0} max={100} step={1} onValueChange={(v) => setTheta((v[0] / 100) * Math.PI)} />
              </GuideField>
              <GuideField label="φ azimuth" info={{ what: 'Complex phase around the vertical axis.', how: 'Drag to spin the start arrow.', example: 'φ = π/2 → |+i⟩.' }} right={<span className="font-mono text-violet-300">{phi.toFixed(2)} rad</span>}>
                <Slider value={[Math.round((phi / (2 * Math.PI)) * 100)]} min={0} max={100} step={1} onValueChange={(v) => setPhi((v[0] / 100) * 2 * Math.PI)} />
              </GuideField>
            </>
          )}
          <GuideField label="Error mode" info={{ what: 'Random sampling lets the channel decide; Manual places a definite error — perfect for reproducing the Phase-1 example.', how: 'Toggle ON to choose the qubit and error type yourself.', example: 'Manual X on q1, bit-flip code → syndrome (1,1) → corrected every time.' }}>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-[11px] text-slate-400">{manualMode ? 'Manual — you place the error' : 'Random — sampled from the channel'}</span>
              <Switch checked={manualMode} onCheckedChange={setManualMode} />
            </div>
          </GuideField>
          {manualMode && (
            <div className="grid grid-cols-2 gap-2">
              <GuideField label="Error qubit" info={{ what: 'Which physical qubit receives the error.', how: 'Pick 0, 1 or 2.', example: 'q1 is the middle data qubit.' }}>
                <Select value={String(errQubit)} onValueChange={(v) => setErrQubit(Number(v))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: code.n }, (_, q) => (
                      <SelectItem key={q} value={String(q)}>q{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </GuideField>
              <GuideField label="Error type" info={{ what: 'X = bit flip, Z = phase flip, Y = both.', how: 'Pick one. Try a Z on the bit-flip code — the syndrome cannot see it!', example: 'X is the classic bit flip.' }}>
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
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-500" onClick={runPipeline} disabled={phase === 'playing'}>
              <Play className="mr-1 h-3.5 w-3.5" /> {phase === 'done' ? 'Run again' : 'Run pipeline'}
            </Button>
            <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300" onClick={reset} disabled={phase === 'playing'}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-[11px] text-slate-400">
              {phase === 'idle' ? 'idle — press Run pipeline' : phase === 'playing' ? 'playing — watch each stage' : 'complete — step through the stages'}
            </span>
            <span className={`h-2 w-2 shrink-0 rounded-full ${phase === 'playing' ? 'animate-pulse bg-amber-400' : phase === 'done' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </div>
          {phase === 'done' && snaps.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" className="border-violet-500/40 px-2 text-violet-300" onClick={() => goStage(stageIdx - 1)} disabled={stageIdx === 0}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="flex flex-1 justify-center gap-1">
                {snaps.map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => goStage(i)}
                    aria-label={`Go to stage ${s.title}`}
                    className={`h-2 w-6 rounded-full transition-all ${i === stageIdx ? 'bg-violet-400' : i < stageIdx ? 'bg-violet-500/40' : 'bg-slate-700'}`}
                  />
                ))}
              </div>
              <Button size="sm" variant="outline" className="border-violet-500/40 px-2 text-violet-300" onClick={() => goStage(stageIdx + 1)} disabled={stageIdx === snaps.length - 1}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <ExportRow onReport={exportReport} onJSON={exportJSONData} onCSV={exportCSVData} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Auto-orbit camera</span>
            <Switch checked={orbit} onCheckedChange={setOrbit} />
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <MousePointer2 className="h-3 w-3" /> drag to orbit · wheel to zoom
          </span>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
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
            <Badge className="absolute right-4 top-4 bg-violet-600/25 text-violet-200 hover:bg-violet-600/25">3D · live pipeline</Badge>
            {cur?.fidelity !== undefined && (
              <div className="absolute right-4 top-12 rounded-lg border border-white/12 bg-black/50 px-3 py-2 text-right backdrop-blur">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">Fidelity</div>
                <div className={`font-mono text-xl font-bold ${cur.fidelity > 0.99 ? 'text-emerald-400' : cur.fidelity > 0.9 ? 'text-violet-300' : 'text-rose-400'}`}>
                  {(cur.fidelity * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* stage readout strip */}
        <Card className="glass border-white/8">
          <CardContent className="p-4">
            {cur ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-violet-600/25 px-2 py-0.5 font-mono text-[11px] font-bold text-violet-200">
                    {STAGE_ORDER.indexOf(cur.key as (typeof STAGE_ORDER)[number]) + 1}/7
                  </span>
                  <span className="text-sm font-semibold text-slate-100">{cur.title}</span>
                  {cur.outcome !== undefined && (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">outcome |{cur.outcome}⟩</Badge>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{cur.desc}</p>
                {cur.detail && <p className="font-mono text-[11px] text-cyan-300">{cur.detail}</p>}
                {cur.syndrome && (
                  <div className="flex flex-wrap gap-1.5">
                    {cur.syndrome.map((s) => (
                      <span key={s.label} className={`rounded-md border px-2 py-1 font-mono text-[11px] ${s.bit ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-slate-600/40 text-slate-400'}`}>
                        {s.label} = {s.bit}
                      </span>
                    ))}
                  </div>
                )}
                {cur.correction && (cur.correction.x.length > 0 || cur.correction.z.length > 0) && (
                  <p className="font-mono text-[11px] text-emerald-300">
                    correction: {cur.correction.x.length ? `X on q${cur.correction.x.join(', q')}` : ''}{cur.correction.x.length && cur.correction.z.length ? ' · ' : ''}{cur.correction.z.length ? `Z on q${cur.correction.z.join(', q')}` : ''}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">
                Press <span className="text-violet-300">Run pipeline</span> — the arrow walks through Input → Encode → Noise → Syndrome → Correct → Decode → Measure in real time, then you can replay any stage.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Bloch Flight 4D                                                      */
/* ==================================================================== */

interface FlightRound {
  round: number;
  fidelity: number;
  bareFidelity: number;
  events: string[];
  detected: boolean;
  corrected: boolean;
}

const MAX_TRAIL = 260;

export function BlochFlight() {
  const [orbit, setOrbit] = useState(true);
  const [codeId, setCodeId] = useState('code-3bitflip');
  const [noise, setNoise] = useState<NoiseModelId>('bitflip');
  const [p, setP] = useState(0.1);
  const [rounds, setRounds] = useState(30);
  const [phase, setPhase] = useState<'idle' | 'playing' | 'done'>('idle');
  const [theta, setTheta] = useState(Math.PI / 3);
  const [phi, setPhi] = useState(Math.PI / 5);
  const [preset, setPreset] = useState('|+i⟩ custom');
  const [qecOn, setQecOn] = useState(true);
  const [hud, setHud] = useState({
    round: 0, fQEC: 1, fBare: 1, avgQEC: 1, avgBare: 1,
    corrections: 0, detected: 0, failures: 0,
  });

  const rafRef = useRef(0);
  const wakeRef = useRef<() => void>(() => {});
  const phaseRef = useRef<'idle' | 'playing' | 'done'>('idle');
  const { cam, canvasRef, setAuto, onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = useOrbitCam(
    { dist: 3.0, yaw: 0.55, pitch: 0.42, auto: true },
    () => wakeRef.current()
  );

  const svRef = useRef<ReturnType<typeof prepareEncodedState> | null>(null);
  const bareRef = useRef<StateVector | null>(null);
  const rngRef = useRef(makeRng(42));
  const trailQRef = useRef<{ v: Vec3; t: number }[]>([]);
  const trailBRef = useRef<{ v: Vec3; t: number }[]>([]);
  const vecQRef = useRef<Vec3>({ x: 0, y: 0.85, z: 0.53 });
  const vecBRef = useRef<Vec3>({ x: 0, y: 0.85, z: 0.53 });
  const dispQRef = useRef<Vec3>({ x: 0, y: 0.85, z: 0.53 });
  const dispBRef = useRef<Vec3>({ x: 0, y: 0.85, z: 0.53 });
  const histQRef = useRef<number[]>([]);
  const histBRef = useRef<number[]>([]);
  const roundRef = useRef(0);
  const countersRef = useRef({ corrections: 0, detected: 0, failures: 0 });
  const historyRef = useRef<FlightRound[]>([]);
  const accRef = useRef(0);
  const lastRef = useRef(0);
  const cfgRef = useRef({ codeId, noise, p, rounds, theta, phi, qecOn });
  useEffect(() => {
    cfgRef.current = { codeId, noise, p, rounds, theta, phi, qecOn };
  }, [codeId, noise, p, rounds, theta, phi, qecOn]);

  const orbitRef = useRef(orbit);
  useEffect(() => { orbitRef.current = orbit; }, [orbit]);
  useEffect(() => {
    setAuto(orbitRef.current);
    wakeRef.current();
  }, [orbit, setAuto]);
  const endDragKeep = () => {
    onPointerUp();
    onPointerLeave();
    setAuto(orbitRef.current);
    wakeRef.current();
  };

  const resetWith = (codeIdNow: string, thetaNow: number, phiNow: number) => {
    const code = getSVCode(codeIdNow);
    svRef.current = prepareEncodedState(code, thetaNow, phiNow);
    const bare1 = new StateVector(1);
    bare1.prepareQubit0(thetaNow, phiNow);
    bareRef.current = bare1;
    rngRef.current = makeRng(Math.floor(Math.random() * 1e9));
    trailQRef.current = [];
    trailBRef.current = [];
    histQRef.current = [];
    histBRef.current = [];
    roundRef.current = 0;
    countersRef.current = { corrections: 0, detected: 0, failures: 0 };
    historyRef.current = [];
    accRef.current = 0;
    phaseRef.current = 'idle';
    setPhase('idle');
    const v = toVec3(thetaNow, phiNow);
    vecQRef.current = { ...v };
    vecBRef.current = { ...v };
    dispQRef.current = { ...v };
    dispBRef.current = { ...v };
    setHud({ round: 0, fQEC: 1, fBare: 1, avgQEC: 1, avgBare: 1, corrections: 0, detected: 0, failures: 0 });
    wakeRef.current(); // redraw the idle sphere
  };

  const reset = () => {
    const c = cfgRef.current;
    resetWith(c.codeId, c.theta, c.phi);
  };

  const switchCode = (id: string) => {
    setCodeId(id);
    resetWith(id, theta, phi);
  };

  /** ONE-SHOT RUN: reset, play exactly `rounds` rounds, then stop for good. */
  const runFlight = () => {
    reset();
    phaseRef.current = 'playing';
    setPhase('playing');
    wakeRef.current();
  };

  useEffect(() => {
    lastRef.current = performance.now();

    const doRound = () => {
      const sv = svRef.current;
      const bare = bareRef.current;
      if (!sv || !bare) return;
      const c = cfgRef.current;
      const code = getSVCode(c.codeId);
      const params = noiseParams(c.p, c.noise);

      const r = runLiveRound(code, sv, c.noise, params, rngRef.current, c.theta, c.phi, c.qecOn);
      const b = runBareRound(bare, c.noise, params, rngRef.current, c.theta, c.phi);

      roundRef.current++;
      if (r.detected) countersRef.current.detected++;
      if (r.correction.x.length || r.correction.z.length) countersRef.current.corrections++;
      if (r.fidelity < 0.5) countersRef.current.failures++;

      histQRef.current.push(r.fidelity);
      histBRef.current.push(b.fidelity);
      if (histQRef.current.length > 2000) histQRef.current.shift();
      if (histBRef.current.length > 2000) histBRef.current.shift();

      vecQRef.current = toCanvasBloch(r.bloch);
      vecBRef.current = toCanvasBloch(b.bloch);
      trailQRef.current.push({ v: { ...toCanvasBloch(r.bloch) }, t: roundRef.current });
      trailBRef.current.push({ v: { ...toCanvasBloch(b.bloch) }, t: roundRef.current });
      if (trailQRef.current.length > MAX_TRAIL) trailQRef.current.shift();
      if (trailBRef.current.length > MAX_TRAIL) trailBRef.current.shift();

      historyRef.current.push({
        round: roundRef.current,
        fidelity: r.fidelity,
        bareFidelity: b.fidelity,
        events: r.noiseEvents.map((e) => `${e.kind}@q${e.qubit}`),
        detected: r.detected,
        corrected: !!(r.correction.x.length || r.correction.z.length),
      });
      if (historyRef.current.length > 2000) historyRef.current.shift();
    };

    const drawFidelityStrip = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      // mini live fidelity chart (bottom strip) with axis + fail line
      const stripH = 96;
      const x0 = 14, y0 = h - stripH - 10, stripW = Math.min(380, w * 0.48);
      ctx.save();
      ctx.fillStyle = 'rgba(13,10,26,0.78)';
      ctx.strokeStyle = 'rgba(139,92,246,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x0, y0, stripW, stripH, 8);
      ctx.fill();
      ctx.stroke();

      const q = histQRef.current.slice(-240);
      const b = histBRef.current.slice(-240);
      const n = Math.max(q.length, 2);
      const plotX = x0 + 30;
      const plotW = stripW - 38;
      const plotY = y0 + 8;
      const plotH = stripH - 30;

      // fail line at F = 0.5
      ctx.strokeStyle = 'rgba(251,113,133,0.5)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(plotX, plotY + plotH * 0.5);
      ctx.lineTo(plotX + plotW, plotY + plotH * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(251,113,133,0.9)';
      ctx.fillText('50%', x0 + 6, plotY + plotH * 0.5 + 3);
      ctx.fillStyle = 'rgba(148,163,184,0.8)';
      ctx.fillText('100%', x0 + 6, plotY + 4);

      const line = (arr: number[], color: string, fill: boolean) => {
        if (arr.length < 2) return;
        if (fill) {
          ctx.beginPath();
          ctx.moveTo(plotX, plotY + plotH);
          for (let i = 0; i < arr.length; i++) {
            const x = plotX + (i / (n - 1)) * plotW;
            const y = plotY + (1 - Math.max(0, Math.min(1, arr[i]))) * plotH;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(plotX + ((arr.length - 1) / (n - 1)) * plotW, plotY + plotH);
          ctx.closePath();
          ctx.fillStyle = 'rgba(167,139,250,0.12)';
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = plotX + (i / (n - 1)) * plotW;
          const y = plotY + (1 - Math.max(0, Math.min(1, arr[i]))) * plotH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      line(b, 'rgba(244,114,182,0.85)', false);
      line(q, 'rgba(167,139,250,0.95)', true);

      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(167,139,250,1)';
      ctx.fillText('F with QEC', x0 + 34, y0 + stripH - 16);
      ctx.fillStyle = 'rgba(244,114,182,1)';
      ctx.fillText('F bare', x0 + 108, y0 + stripH - 16);
      ctx.fillStyle = 'rgba(148,163,184,0.9)';
      ctx.fillText('live fidelity — last rounds', x0 + 34, y0 + stripH - 5);
      ctx.restore();
    };

    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) return phaseRef.current === 'playing';
      // lazy state init — guarantees the idle sphere + arrows are drawn
      // immediately when the tab opens, instead of a black canvas until
      // the user presses Run (the v10 bug).
      if (!svRef.current) {
        const c0 = cfgRef.current;
        svRef.current = prepareEncodedState(getSVCode(c0.codeId), c0.theta, c0.phi);
        const bare0 = new StateVector(1);
        bare0.prepareQubit0(c0.theta, c0.phi);
        bareRef.current = bare0;
        const v0 = toVec3(c0.theta, c0.phi);
        vecQRef.current = { ...v0 };
        vecBRef.current = { ...v0 };
        dispQRef.current = { ...v0 };
        dispBRef.current = { ...v0 };
      }
      const fit = fitCanvas(cv);
      if (!fit) return phaseRef.current === 'playing';
      const { w, h, ctx } = fit;
      const c = cfgRef.current;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastRef.current) / 1000);
      lastRef.current = now;
      const camO = cam.current as Cam;
      if (camO.auto) camO.yaw += dt * 0.13; // gentle idle orbit

      // ---- ONE-SHOT physics: play exactly c.rounds rounds, then stop for good
      if (phaseRef.current === 'playing') {
        accRef.current += dt;
        const interval = 1 / 5; // readable playback: 5 rounds per second
        let progressed = false;
        while (accRef.current > interval && roundRef.current < c.rounds) {
          doRound();
          accRef.current -= interval;
          progressed = true;
        }
        if (roundRef.current >= c.rounds) {
          phaseRef.current = 'done';
          setPhase('done');
        }
        if (progressed) {
          const q = histQRef.current, b = histBRef.current;
          const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 1);
          setHud({
            round: roundRef.current,
            fQEC: q.length ? q[q.length - 1] : 1,
            fBare: b.length ? b[b.length - 1] : 1,
            avgQEC: avg(q),
            avgBare: avg(b),
            corrections: countersRef.current.corrections,
            detected: countersRef.current.detected,
            failures: countersRef.current.failures,
          });
        }
      }

      // smooth vector easing
      const ease = 1 - Math.exp(-dt * 6);
      const lerpV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + (b.x - a.x) * ease, y: a.y + (b.y - a.y) * ease, z: a.z + (b.z - a.z) * ease });
      dispQRef.current = lerpV(dispQRef.current, vecQRef.current);
      dispBRef.current = lerpV(dispBRef.current, vecBRef.current);

      // render
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.47;
      const scale = Math.min(w, h) * 0.36;

      drawWireSphere(ctx, camO, cx, cy, scale, 'rgba(134,126,205,0.62)');

      // target pin — the state the flight started from (QEC tries to hold it)
      const target = toVec3(c.theta, c.phi);
      dot3D(ctx, target, camO, cx, cy, scale, 'rgba(103,232,249,0.28)', 9, 0);
      dot3D(ctx, target, camO, cx, cy, scale, 'rgba(103,232,249,0.95)', 3, 10);
      label3D(ctx, 'target |ψ⟩', { x: target.x * 1.16, y: target.y * 1.16, z: target.z * 1.16 }, camO, cx, cy, scale, 'rgba(103,232,249,0.95)', '10px ui-sans-serif', 6, -6);

      // axes + labels
      const axes: { v: Vec3; label: string }[] = [
        { v: { x: 0, y: 1.18, z: 0 }, label: '|0⟩' },
        { v: { x: 0, y: -1.18, z: 0 }, label: '|1⟩' },
        { v: { x: 1.2, y: 0, z: 0 }, label: '|+⟩' },
        { v: { x: -1.2, y: 0, z: 0 }, label: '|−⟩' },
        { v: { x: 0, y: 0, z: 1.2 }, label: '|+i⟩' },
        { v: { x: 0, y: 0, z: -1.2 }, label: '|−i⟩' },
      ];
      for (const ax of axes) {
        stroke3D(ctx, [{ x: 0, y: 0, z: 0 }, ax.v], camO, cx, cy, scale, 'rgba(100,90,150,0.4)', 0.8, [3, 3]);
        label3D(ctx, ax.label, ax.v, camO, cx, cy, scale, '#8b85ad', '10px monospace', 0, 0);
      }

      // trails — time as color: old = deep violet, recent = cyan (4th dimension)
      const trailColor = (ageFrac: number) => {
        // ageFrac 0 = newest
        const hue = 190 + ageFrac * 75; // cyan(190) → violet(265)
        const light = 72 - ageFrac * 18;
        return `hsla(${hue.toFixed(0)}, 90%, ${light.toFixed(0)}%, ${(0.9 - ageFrac * 0.55).toFixed(2)})`;
      };
      const drawTrail = (trail: { v: Vec3; t: number }[]) => {
        for (let i = 1; i < trail.length; i++) {
          const age = 1 - i / trail.length;
          stroke3D(ctx, [trail[i - 1].v, trail[i].v], camO, cx, cy, scale, trailColor(1 - age), 2.8 - age * 1.4);
        }
        if (trail.length) {
          const newest = trail[trail.length - 1];
          dot3D(ctx, newest.v, camO, cx, cy, scale, 'rgba(103,232,249,0.9)', 2.6, 9);
        }
      };
      drawTrail(trailQRef.current);
      drawTrail(trailBRef.current);

      // round progress on-canvas while playing
      if (phaseRef.current === 'playing') {
        ctx.save();
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.fillStyle = 'rgba(226,232,240,0.92)';
        ctx.fillText(`round ${Math.min(roundRef.current, c.rounds)} / ${c.rounds}`, w - 132, 26);
        ctx.restore();
      }

      // vectors
      drawArrow3D(ctx, dispBRef.current, camO, cx, cy, scale, '#f472b6', 2.2, true);
      drawArrow3D(ctx, dispQRef.current, camO, cx, cy, scale, '#a78bfa', 3);

      // legend + hud strip
      ctx.save();
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(167,139,250,1)';
      ctx.fillText('— logical qubit with QEC', 14, 22);
      ctx.fillStyle = 'rgba(244,114,182,1)';
      ctx.fillText('- - bare qubit (no protection)', 14, 38);
      ctx.fillStyle = 'rgba(103,232,249,0.9)';
      ctx.fillText('trajectory trail: color encodes time (now → past)', 14, 54);
      ctx.restore();

      drawFidelityStrip(ctx, w, h);

      // keep animating ONLY while the flight is playing or the arrows are
      // still settling — once everything is at rest the loop fully stops
      const settled =
        Math.abs(dispQRef.current.x - vecQRef.current.x) < 0.004 &&
        Math.abs(dispQRef.current.y - vecQRef.current.y) < 0.004 &&
        Math.abs(dispQRef.current.z - vecQRef.current.z) < 0.004 &&
        Math.abs(dispBRef.current.x - vecBRef.current.x) < 0.004 &&
        Math.abs(dispBRef.current.y - vecBRef.current.y) < 0.004 &&
        Math.abs(dispBRef.current.z - vecBRef.current.z) < 0.004;
      return phaseRef.current === 'playing' || !settled || camO.auto;
    };

    const loop = () => {
      const keep = draw();
      rafRef.current = keep ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (!rafRef.current) {
        lastRef.current = performance.now();
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    wakeRef.current = wake;

    wake(); // render one static frame on mount
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      wakeRef.current = () => {};
    };
  }, []);

  const applyPreset = (label: string) => {
    const pr = STATE_PRESETS.find((s) => s.label === label);
    if (!pr) return;
    setPreset(label);
    if (pr.theta >= 0) {
      setTheta(pr.theta);
      setPhi(pr.phi);
    }
  };

  const exportReport = () => {
    const rows = historyRef.current.slice(-150);
    const code = getSVCode(codeId);
    openPrintableReport(
      { title: 'Bloch Flight 4D — Live QEC Trajectory Experiment', runKind: 'Real-Time 4D Visualizer' },
      [
        {
          heading: 'Inputs',
          kv: [
            ['QEC code', `${code.name} [[${code.n},${code.k},${code.d}]]`],
            ['Noise model', NOISE_LABELS[noise] ?? noise],
            ['Noise strength p', p.toFixed(3)],
            ['Input state', `|ψ⟩, θ = ${theta.toFixed(2)} rad, φ = ${phi.toFixed(2)} rad`],
            ['Correction rounds', qecOn ? 'Enabled every round' : 'DISABLED (raw decoherence observed)'],
            ['Rounds flown', `${hud.round} (one-shot run — stopped at completion)`],
            ['Generated at', nowStamp()],
          ],
        },
        {
          heading: 'Outputs — Trajectory Statistics',
          cards: [
            { label: 'Rounds flown', value: String(hud.round) },
            { label: 'Avg F (with QEC)', value: `${(hud.avgQEC * 100).toFixed(2)}%`, tone: 'good' },
            { label: 'Avg F (bare)', value: `${(hud.avgBare * 100).toFixed(2)}%`, tone: 'bad' },
            { label: 'Corrections', value: String(hud.corrections) },
            { label: 'Severe corruptions', value: String(hud.failures), tone: hud.failures ? 'bad' : 'good' },
          ],
        },
        {
          heading: 'Per-Round Ledger (last 150 rounds)',
          table: {
            headers: ['Round', 'F with QEC', 'F bare', 'Noise events', 'Syndrome', 'Correction'],
            rows: rows.map((r) => [r.round, (r.fidelity * 100).toFixed(2) + '%', (r.bareFidelity * 100).toFixed(2) + '%', r.events.join(' ') || 'none', r.detected ? 'flagged' : 'trivial', r.corrected ? 'applied' : '—']),
          },
          note: 'Each round: noise channel on the encoded block → projective stabilizer measurement → decoder correction → logical readout. The bare-qubit column applies the identical noise to an unprotected qubit.',
        },
        {
          heading: 'Methodology',
          text: `The logical Bloch vector is read out after every round from the logical density matrix (inverse-circuit readout, non-destructive — the encoded state survives), so trajectories continue across rounds. The trail is colored by round index — the fourth dimension — so the full history remains visible on the sphere. Team: ${TEAM_NAMES.join(', ')}.`,
        },
      ]
    );
  };

  const exportJSONData = () => {
    downloadJSON(`bloch-flight-${codeId}-${runId()}.json`, {
      experiment: 'Bloch Flight 4D — live QEC trajectory',
      generatedAt: nowStamp(),
      team: TEAM_NAMES,
      inputs: { code: codeId, noise, p, theta, phi, qecOn, rounds },
      totals: hud,
      rounds: historyRef.current,
      trailQEC: trailQRef.current.map((pt) => ({ ...pt.v, round: pt.t })),
      trailBare: trailBRef.current.map((pt) => ({ ...pt.v, round: pt.t })),
    });
  };

  const exportCSVData = () => {
    downloadCSV(
      `bloch-flight-${codeId}-${runId()}.csv`,
      ['round', 'fidelityQEC', 'fidelityBare', 'noiseEvents', 'syndromeFlagged', 'corrected'],
      historyRef.current.map((r) => [r.round, r.fidelity.toFixed(6), r.bareFidelity.toFixed(6), r.events.join(' '), r.detected ? 1 : 0, r.corrected ? 1 : 0])
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <Card className="glass border-white/8">
        <CardContent className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Bloch Flight Controls</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              A logical qubit flies round after round through real noise + correction cycles. The sphere shows its
              full spacetime history.
            </p>
          </div>
          <GuideField label="QEC Code" info={{ what: 'Which code protects the flying logical qubit.', how: 'Pick one — the flight resets and re-encodes.', example: '3-Qubit Bit-Flip survives a single X error in every single round.' }}>
            <Select value={codeId} onValueChange={switchCode}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SV_CODES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.short} · [[{c.n},{c.k},{c.d}]]</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </GuideField>
          <GuideField label="Noise Model" info={{ what: 'The physical disturbance applied EVERY round to all qubits of the block — the same channel also hits the bare comparison qubit.', how: 'Pick one of the three project channels.', example: 'Bit-Flip at 10%: each round, every qubit independently risks flipping.' }}>
            <Select value={noise} onValueChange={(v) => setNoise(v as NoiseModelId)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(NOISE_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </GuideField>
          <GuideField
            label="Noise strength p"
            info={{ what: 'The per-round probability that each qubit is hit by the selected noise. This drives how violently the trajectory is kicked.', how: 'Drag from 0 to 50%. Around or above 20–30%, the small codes stop coping — watch the violet arrow start to wander.', example: 'p = 0.10 → typically a couple of errors per dozen rounds; the decoder absorbs them.' }}
            hint="How hard each round hits. 10% is a good start."
            right={<span className="font-mono text-violet-300">{p.toFixed(3)}</span>}
          >
            <Slider value={[Math.round(p * 500)]} min={0} max={250} step={1} onValueChange={(v) => setP(v[0] / 500)} />
          </GuideField>
          <GuideField label="Input State |ψ⟩" info={{ what: 'The state the logical qubit starts in, shown as an arrow on the Bloch sphere (θ from the |0⟩ pole, φ around the axis).', how: 'Click a preset or pick Custom and use the two sliders below. The flight re-encodes from this state.', example: '|+i⟩ starts on the equator — a good stress test because both amplitude and phase must survive.' }}>
            <div className="flex flex-wrap gap-1.5">
              {STATE_PRESETS.map((s) => (
                <Button
                  key={s.label}
                  size="sm"
                  variant={preset === s.label ? 'default' : 'outline'}
                  className={preset === s.label ? 'bg-violet-600 hover:bg-violet-500' : 'border-violet-400/30 bg-white/[0.03] text-slate-300'}
                  onClick={() => applyPreset(s.label)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </GuideField>
          <GuideField label="θ polar" info={{ what: 'Polar angle from the |0⟩ pole: 0 = |0⟩, π = |1⟩, π/2 = equator.', how: 'Drag to set the |0⟩/|1⟩ mix of the start state.', example: 'θ = π/3 tilts the arrow 60° from the pole.' }} right={<span className="font-mono text-violet-300">{theta.toFixed(2)} rad</span>}>
            <Slider value={[Math.round((theta / Math.PI) * 100)]} min={0} max={100} step={1} onValueChange={(v) => setTheta((v[0] / 100) * Math.PI)} />
          </GuideField>
          <GuideField label="φ azimuth" info={{ what: 'Azimuth around the vertical axis — the complex phase of the start state.', how: 'Drag to spin the start arrow around the equator.', example: 'φ = π/2 puts the state at |+i⟩.' }} right={<span className="font-mono text-violet-300">{phi.toFixed(2)} rad</span>}>
            <Slider value={[Math.round((phi / (2 * Math.PI)) * 100)]} min={0} max={100} step={1} onValueChange={(v) => setPhi((v[0] / 100) * 2 * Math.PI)} />
          </GuideField>
          <GuideField label="Rounds to run" info={{ what: 'How many noise + correction rounds the flight plays in ONE run. The simulation runs exactly this many rounds and then stops — a complete, bounded experiment, not an endless loop.', how: '20–40 rounds shows the encode → detect → correct loop clearly; 100+ stresses the code long-term. Press Run again any time for a fresh flight with new random noise.', example: '30 rounds at 10% bit-flip noise: several errors hit the block, the decoder catches them, and the violet arrow stays pinned near its target.' }} right={<span className="font-mono text-violet-300">{rounds} rounds</span>}>
            <Slider value={[rounds]} min={10} max={100} step={5} onValueChange={(v) => setRounds(v[0])} />
          </GuideField>
          <GuideField label="QEC correction" info={{ what: 'Turns the decoder on or off for the run. OFF shows raw decoherence — the honest “before” picture with no protection.', how: 'Set it before a run, or flip it mid-run while the flight is playing. With QEC ON the violet arrow snaps back to its target; with OFF it random-walks away like the pink ghost.', example: 'Run 30 rounds with QEC OFF and watch the violet arrow wander — flip ON and run again to watch the decoder drag it home.' }}>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <span className="text-[11px] text-slate-400">{qecOn ? 'ON — decoder cleans every round' : 'OFF — watching raw decoherence'}</span>
              <Switch checked={qecOn} onCheckedChange={setQecOn} />
            </div>
          </GuideField>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-500" onClick={runFlight} disabled={phase === 'playing'}>
              <Play className="mr-1 h-3.5 w-3.5" /> {phase === 'done' ? 'Run again' : 'Run flight'}
            </Button>
            <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300" onClick={reset} disabled={phase === 'playing'}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-[11px] text-slate-400">
              {phase === 'idle' ? 'idle — press Run flight' : phase === 'playing' ? `running — round ${hud.round} / ${rounds}` : 'complete — simulation stopped'}
            </span>
            <span className={`h-2 w-2 shrink-0 rounded-full ${phase === 'playing' ? 'animate-pulse bg-amber-400' : phase === 'done' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatChip label="Round" value={String(hud.round)} />
            <StatChip label="Corrections" value={String(hud.corrections)} tone="good" />
          </div>
          <ExportRow onReport={exportReport} onJSON={exportJSONData} onCSV={exportCSVData} />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Auto-orbit camera</span>
            <Switch checked={orbit} onCheckedChange={setOrbit} />
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
            className="h-[640px] w-full cursor-grab touch-none rounded-lg active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDragKeep}
            onPointerLeave={endDragKeep}
          />
          <Badge className="absolute right-4 top-4 bg-violet-600/25 text-violet-200 hover:bg-violet-600/25">4D · space + time trail</Badge>
          <div className="absolute right-4 top-12 flex flex-col items-end gap-1.5">
            <div className="rounded-lg border border-white/12 bg-black/50 px-3 py-2 text-right backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">F with QEC (now)</div>
              <div className={`font-mono text-xl font-bold ${(hud.fQEC * 100).toFixed(1) === '100.0' || hud.fQEC > 0.99 ? 'text-emerald-400' : hud.fQEC > 0.9 ? 'text-violet-300' : 'text-rose-400'}`}>
                {(hud.fQEC * 100).toFixed(1)}%
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">F bare (now)</div>
              <div className="font-mono text-sm text-rose-300">{(hud.fBare * 100).toFixed(1)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ==================================================================== */
/* Lab shell                                                            */
/* ==================================================================== */

const SUBTABS = [
  {
    id: 'sphere',
    label: 'Bloch Sphere',
    icon: Globe,
    title: 'Bloch Sphere — the pipeline, live on the sphere',
    blurb:
      'The full error-correction pipeline of our project — Input → Encode → Noise → Syndrome → Correct → Decode → Measure — executed for real, stage by stage, while the state arrow moves on the Bloch sphere. Watch exactly where the noise kicks the state and where the decoder pulls it back.',
    reading: [
      'Violet arrow = the live logical state, recomputed from the engine after every stage.',
      'Cyan pin = your requested input |ψ⟩ — how close the arrow lands is the fidelity.',
      'Every stage runs the real engine: encoding circuit, quantum-trajectory noise, projective syndrome checks, decoder correction, inverse-circuit decode.',
    ],
    tryThis: 'Turn Error mode ON, set X on q1 with the Bit-Flip code, and Run — the arrow jumps at Noise and snaps home at Correct. Then try Z on the same code: the syndrome cannot see it, a real QEC limitation!',
  },
  {
    id: 'flight',
    label: 'Bloch Flight 4D',
    icon: Orbit,
    title: 'Bloch Flight — 4D QEC Trajectory (one-shot run)',
    blurb:
      'A logical qubit flies through a fixed number of noisy rounds, then the flight stops. The colored trail is time itself — the 4th dimension: watch QEC hold the state on its target while the unprotected ghost drifts away.',
    reading: [
      'Violet arrow = protected logical qubit · pink dashed = same noise, no protection.',
      'Trail color = time: cyan is “now”, deep violet is older — the 4th dimension made visible.',
      'Press Run: it plays exactly N rounds once, stops with “complete — stopped”, and you can orbit the result.',
    ],
    tryThis: 'Turn “QEC correction” OFF, run 30 rounds and watch the violet arrow wander off with the pink ghost. Turn it back ON, run again, and watch the decoder pull it home.',
  },
  {
    id: 'circuit3d',
    label: 'Circuit & Error Propagation',
    icon: Workflow,
    title: '3D Circuit & Error Propagation — watch one error become many',
    blurb:
      'The selected code’s real encoding circuit rendered as a 3D board. Inject an X, Z or Y error at any qubit and any moment, and the glowing pulse rides the rails, splitting and morphing through the gates with the exact Clifford rules — the physics reason QEC needs distance and repeated rounds. Below it, the same full pipeline circuit the Simulator Lab draws, with a live annotated shot.',
    reading: [
      'Glowing markers = where errors sit as they pass each gate (rose = X, amber = Z, fuchsia = Y).',
      'X through a CNOT control copies onto the target; Z through a CNOT target copies back onto the control; H swaps X ↔ Z — real stabilizer-formalism propagation.',
      'The flat circuit underneath runs the FULL pipeline with the sampled noise + decoder corrections annotated, exactly like the Simulator Lab.',
    ],
    tryThis: 'Inject Y on q0 of the Shor Code before gate 1 and run — one error becomes a whole constellation by the output. Then inject the same error at the very END and see how small it stays.',
  },
];

export default function QuantumLab3D() {
  const [sub, setSub] = useState('sphere');
  const active = SUBTABS.find((s) => s.id === sub)!;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="mb-1 text-xl font-semibold text-slate-100">3D Quantum Lab — Real-Time Visualization Suite</h2>
        <p className="text-sm text-slate-500">
          Three physics-driven visualizers powered by the same verified QEC engine as the Simulator Lab — the Bloch-sphere
          pipeline walk, the round-by-round trajectory flight, and the 3D circuit with live error propagation. Every
          simulation is a one-shot run: press Run, watch it play through, and it stops when complete. Orbit, zoom and
          export reports from all of them.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUBTABS.map((s) => {
          const Icon = s.icon;
          const on = s.id === sub;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all ${
                on
                  ? 'border-violet-400/60 bg-violet-600/25 text-violet-100 shadow-[0_0_18px_rgba(139,92,246,0.25)]'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-violet-400/40 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl glass border-white/8 px-4 py-3">
        <div className="text-sm font-semibold text-slate-100">{active.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-400">{active.blurb}</div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {active.reading.map((r) => (
            <div key={r} className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-2.5 text-[11px] leading-relaxed text-slate-300">{r}</div>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-200/90">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><span className="font-semibold text-amber-200">Try this:</span> {active.tryThis}</span>
        </div>
      </div>

      {sub === 'sphere' && <BlochSphereWalkthrough />}
      {sub === 'flight' && <BlochFlight />}
      {sub === 'circuit3d' && <CircuitError3D />}
    </div>
  );
}
