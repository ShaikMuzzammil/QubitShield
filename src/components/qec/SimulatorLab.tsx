'use client';

/**
 * Simulator Lab: single-shot QEC pipeline visualization.
 * SCOPE — the QEC codes (3-qubit bit-flip, 3-qubit phase-flip, Shor 9-qubit)
 * × three noise channels of all_with_noise_prob.py:
 * encode → noise → syndrome → correct → decode → measure, with plain-language
 * guides, live Bloch-sphere readouts, the FULL large pipeline circuit,
 * the 11-row output summary (input/encoded state, noise configuration,
 * syndrome, correction, measurement distribution, logical error/success rate,
 * state fidelity, comparison, runtime, reproducibility) and
 * PDF/JSON/CSV/PNG exports that show exactly how every number was computed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Play, Dices, Zap, CircleCheck, CircleX, FileText, Braces, Cpu, ScanSearch, Wand2, CornerDownLeft, Target, RotateCcw, ImageDown, Maximize2, Minimize2, ListOrdered, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { runTrace, runDistributionAsync, ShotTrace, DistributionResult } from '@/lib/qec/pipeline';
import { getSVCode } from '@/lib/qec/codes';
import { NoiseModelId, NoiseParams, noiseParams } from '@/lib/qec/noise';
import { CODE_REGISTRY, getCodeMeta } from '@/lib/qec/registry';
import { makeRng } from '@/lib/qec/engine';
import { buildFullCircuit, ShotAnnotation, describeSyndrome, describeCorrection, describeNoise } from '@/lib/qec/circuit';
import { downloadJSON, downloadCSV, openPrintableReport, runId, nowStamp, TEAM_NAMES } from '@/lib/report';
import BlochSphere from './BlochSphere';
import CircuitDiagram, { exportCircuitPNG, svgToPngDataUrl } from './CircuitDiagram';
import { GuideField, HowToCard, ResultTabs, MeaningCard, TryBox, GuideInfo } from './Guide';

const NOISE_LABELS: Record<string, string> = {
  bitflip: 'Bit-Flip (X)',
  phaseflip: 'Phase-Flip (Z)',
  depolarizing: 'Depolarizing',
};

const STATE_PRESETS = [
  { label: '|0⟩', theta: 0, phi: 0 },
  { label: '|1⟩', theta: Math.PI, phi: 0 },
  { label: '|+⟩', theta: Math.PI / 2, phi: 0 },
  { label: '|−⟩', theta: Math.PI / 2, phi: Math.PI },
  { label: '|+i⟩', theta: Math.PI / 2, phi: Math.PI / 2 },
  { label: 'Custom', theta: -1, phi: -1 },
];

const CIRCUIT_SVG_ID = 'qec-sim-circuit-svg';

/* ---------------- simple-language guides for every input ---------------- */

const CODE_INFO: GuideInfo = {
  what: "A quantum error correction (QEC) code spreads ONE logical qubit's information across several physical qubits, so hardware errors can be detected and undone. The label [[n,k,d]] means: n = physical qubits used, k = logical qubits protected, d = code distance — the code fixes any ⌊(d−1)/2⌋ errors.",
  how: "Pick one of the three codes — all run live in your browser. New here? Start with '3-Qubit Bit-Flip', the same code as the Phase-1 worked example. Under depolarizing noise (X, Y and Z mixed), switch to the Shor Code — it corrects any single error of any kind.",
  example: 'Choosing 3-Qubit Bit-Flip [[3,1,3]] uses 3 physical qubits to protect 1 logical qubit and can fix any single bit-flip (X) error. The Shor Code [[9,1,3]] uses 9 qubits and fixes any single X, Y or Z error.',
};

const NOISE_INFO: GuideInfo = {
  what: 'The physical disturbance applied to your qubits. Real quantum hardware is never perfect: values flip (bit-flip X), phases flip (Z), or errors arrive mixed (depolarizing). This simulator implements exactly these 3 channels — the same set as our Python reference program.',
  how: 'Choose a channel — all three work with every code. Not sure? Keep Bit-Flip (X): it is the classic, easiest-to-follow example. For depolarizing noise the Shor Code gives the strongest protection.',
  example: 'Bit-Flip (X) at 10%: on every shot, each qubit independently has a 10% chance of flipping |0⟩↔|1⟩.',
};

const P_INFO: GuideInfo = {
  what: 'The strength of the selected noise — the probability that each qubit is hit during one shot (0.100 = 10%).',
  how: 'Drag the slider. 10% is the Phase-1 example. Raise it to stress-test the code: at some point protection breaks down — that tipping point is the pseudo-threshold.',
  example: 'p = 0.10 with the 3-qubit bit-flip code → single errors are detected and corrected; the logical qubit survives nearly every shot.',
};

const STATE_INFO: GuideInfo = {
  what: 'The quantum state your logical qubit starts in: |ψ⟩ = α|0⟩ + β|1⟩, drawn as an arrow on the Bloch sphere. θ (polar angle) sets the mix between |0⟩ and |1⟩; φ (azimuth) sets the complex phase between them.',
  how: 'Click a preset, or choose Custom and drag the θ / φ sliders. |0⟩ and |1⟩ are the sphere poles; |+⟩, |−⟩, |+i⟩ sit on the equator (equal mixes with different phase).',
  example: '|+⟩ = a 50/50 mix of |0⟩ and |1⟩ — measuring it would return 0 or 1 with equal probability.',
};

const THETA_INFO: GuideInfo = {
  what: 'Polar angle on the Bloch sphere: 0 = |0⟩ (north pole), π = |1⟩ (south pole), π/2 = equator (equal mix).',
  how: 'Drag to set how much |0⟩ vs |1⟩ your state contains.',
  example: 'θ = π/2 → an equal superposition of |0⟩ and |1⟩.',
};

const PHI_INFO: GuideInfo = {
  what: 'Azimuth angle around the vertical axis — the complex phase between the α and β amplitudes. Two states can share the same θ and still differ by phase.',
  how: 'Drag from 0 to 2π to spin the arrow around the equator.',
  example: 'φ = 0 → |+⟩; φ = π → |−⟩; φ = π/2 → |+i⟩.',
};

const MANUAL_INFO: GuideInfo = {
  what: 'Instead of letting the random number generator decide, you place the errors yourself — deterministic and repeatable, perfect for reproducing the Phase-1 worked example.',
  how: 'Switch ON, then click the qubit buttons (they cycle I → X → Z → Y). Your errors are injected in every shot and the sampled noise is disabled.',
  example: 'Turn ON, set q1 = X on the 3-qubit code, then Run Shot → the syndrome flags exactly that qubit and the decoder fixes it.',
};

const SEED_INFO: GuideInfo = {
  what: 'The starting point of the pseudo-random number generator. Same seed + same settings = the exact same “random” outcome — this is what makes every experiment reproducible.',
  how: 'Leave it, drag it, or press the dice button to reroll a fresh seed before each shot. Note the value down if you need identical results in a report later.',
  example: 'Seed 42 on the default setup always produces the same noise event — run it twice and compare.',
};

const SHOTS_INFO: GuideInfo = {
  what: 'How many independent pipeline repetitions the distribution run executes. Each shot samples fresh noise, re-runs the full circuit and adds one count to the measurement distribution.',
  how: '100–200 shots gives a quick picture; 500–1000 gives smooth statistics. The Shor code (9 qubits) needs more shots than the 3-qubit codes for the same smoothness.',
  example: '200 shots at p = 10% bit-flip noise: most shots end with the trivial syndrome; the flipped ones show the error patterns in the histogram.',
};

function stateLabelOf(theta: number, phi: number): string {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  if (Math.abs(s) < 1e-9) return theta < Math.PI / 2 ? '|0⟩' : '|1⟩';
  if (Math.abs(c) < 1e-9) return phi === 0 ? '|1⟩' : `e^(i${phi.toFixed(2)})|1⟩`;
  if (Math.abs(c - s) < 1e-9 && Math.abs(phi) < 1e-9) return '|+⟩';
  if (Math.abs(c + s) < 1e-9 && Math.abs(phi) < 1e-9) return '|−⟩';
  return `cos(${(theta / 2).toFixed(2)})|0⟩ + e^(i${phi.toFixed(2)})·sin(${(theta / 2).toFixed(2)})|1⟩`;
}

export default function SimulatorLab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [codeId, setCodeId] = useState('code-3bitflip');
  const [noise, setNoise] = useState<NoiseModelId>('bitflip');
  const [p, setP] = useState(0.1);
  const [theta, setTheta] = useState(0);
  const [phi, setPhi] = useState(0);
  const [statePreset, setStatePreset] = useState('|0⟩');
  const [seed, setSeed] = useState(42);
  const [manualMode, setManualMode] = useState(false);
  const [manualErrors, setManualErrors] = useState<Map<string, number>>(new Map());
  const [trace, setTrace] = useState<ShotTrace | null>(null);
  const [running, setRunning] = useState(false);
  const [playStage, setPlayStage] = useState<number | null>(null); // null idle · 0..5 playing · 6 done
  const [dist, setDist] = useState<DistributionResult | null>(null);
  const [distShots, setDistShots] = useState(200);
  const [distRunning, setDistRunning] = useState(false);
  const [distProgress, setDistProgress] = useState(0);
  const [circuitFit, setCircuitFit] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // one-shot pipeline playback: advances the rail stage every 420ms, then stops
  const startPlayback = () => {
    if (playRef.current) clearInterval(playRef.current);
    setPlayStage(0);
    let s = 0;
    playRef.current = setInterval(() => {
      s += 1;
      setPlayStage(Math.min(s, 6));
      if (s >= 6 && playRef.current) {
        clearInterval(playRef.current);
        playRef.current = null;
      }
    }, 420);
  };
  useEffect(() => () => { if (playRef.current) clearInterval(playRef.current); }, []);

  const codeMeta = useMemo(() => getCodeMeta(codeId), [codeId]);
  const svCode = useMemo(() => getSVCode(codeId), [codeId]);
  const compatNoise = useMemo(() => codeMeta.compat, [codeMeta]);

  // any input change invalidates a previous distribution run
  useEffect(() => { setDist(null); }, [codeId, noise, p, theta, phi, seed, manualMode, manualErrors, distShots]);

  const switchCode = (id: string) => {
    setCodeId(id);
    const meta = getCodeMeta(id);
    if (!meta.compat.includes(noise)) setNoise(meta.compat[0]);
    setTrace(null);
  };

  const applyPreset = (label: string) => {
    const preset = STATE_PRESETS.find((s) => s.label === label);
    if (!preset) return;
    setStatePreset(label);
    if (preset.theta >= 0) {
      setTheta(preset.theta);
      setPhi(preset.phi);
    }
  };

  const params: NoiseParams = noiseParams(p, noise);

  const runShot = () => {
    setRunning(true);
    try {
      const forced = manualMode
        ? [...manualErrors.entries()].map(([k, st]) => ({
            qubit: Number(k.split(',')[1]),
            x: st === 1 || st === 3,
            z: st === 2 || st === 3,
          }))
        : null;
      const t = runTrace(svCode, noise, params, theta, phi, seed, forced);
      setTrace(t);
      startPlayback();
    } finally {
      setRunning(false);
    }
  };

  const randomShot = () => {
    setSeed(Math.floor(Math.random() * 1e9));
    setTimeout(runShot, 0);
  };

  const runDist = () => {
    if (distRunning) return;
    setDistRunning(true);
    setDistProgress(0);
    runDistributionAsync(svCode, noise, params, theta, phi, distShots, seed, 0, (done, total) =>
      setDistProgress(Math.round((done / total) * 100))
    )
      .then((d) => setDist(d))
      .finally(() => {
        setDistRunning(false);
        setDistProgress(0);
      });
  };

  const toggleInject = (r: number, c: number, next: number) => {
    const q = `${r},${c}`;
    const nextMap = new Map(manualErrors);
    if (next === 0) nextMap.delete(q);
    else nextMap.set(q, next);
    setManualErrors(nextMap);
  };

  /* ---------------- full pipeline circuit (large view) ---------------- */

  const fullCircuit = useMemo(
    () => buildFullCircuit(svCode, trace?.stateLabel ?? stateLabelOf(theta, phi)),
    [svCode, trace?.stateLabel, theta, phi]
  );

  const annotation: ShotAnnotation | null = trace
    ? {
        noiseEvents: trace.noiseEvents.map((e) => ({ qubit: e.qubit, kind: e.kind })),
        correction: trace.correction,
        syndrome: trace.syndrome.map((s) => s.bit),
        measuredOutcome: trace.measuredOutcome,
      }
    : null;

  /* ---------------- export helpers (formal reports: inputs + outputs) */

  const configRows = (extra: [string, string][] = []): [string, string][] => {
    const base: [string, string][] = [
      ['QEC code', `${codeMeta.name} — [[${codeMeta.n},${codeMeta.k},${codeMeta.d}]]`],
      ['Engine', 'Full state-vector simulator'],
      ['Noise model', NOISE_LABELS[noise] ?? noise],
      ['Noise strength p', p.toFixed(3)],
      ['Input state |ψ⟩', statePreset === 'Custom' ? `θ = ${theta.toFixed(2)} rad, φ = ${phi.toFixed(2)} rad` : statePreset],
      ['RNG seed', String(seed)],
    ];
    if (manualMode) {
      const desc = [...manualErrors.entries()].map(([k, st]) => `q${k.split(',')[1]}:${['I', 'X', 'Z', 'Y'][st]}`).join(' ') || 'none';
      base.push(['Manual error injection', `${manualMode ? 'ON' : 'OFF'} — ${desc}`]);
    }
    return [...base, ...extra];
  };

  /** numbered "how it came" walkthrough — shared by the UI tab and the PDF export */
  const buildStepLog = (t: ShotTrace): { title: string; body: string }[] => [
    {
      title: '1 · Input state prepared',
      body: `Logical qubit prepared in ${t.stateLabel} (θ = ${t.theta.toFixed(3)} rad, φ = ${t.phi.toFixed(3)} rad) on q0 of the state-vector engine.`,
    },
    {
      title: '2 · Encoded into the codespace',
      body: `${t.codeName} encoding circuit applied: ${t.encodedAmps.length ? t.encodedAmps.slice(0, 4).map((a) => `${a.label} (${(a.prob * 100).toFixed(1)}%)`).join(' · ') : 'unitary encoding'} — the logical information now lives spread across the physical qubits.`,
    },
    {
      title: '3 · Noise sampled (quantum trajectories)',
      body: describeNoise(t.noiseEvents, t.noiseName, t.p),
    },
    {
      title: '4 · Syndrome extracted (projective stabilizer measurements)',
      body: `Syndrome bits [${t.syndrome.map((s) => s.bit).join(' ')}] for checks (${t.syndrome.map((s) => s.label).join(', ')}) — ${describeSyndrome(svCode, t.syndrome.map((s) => s.bit))}`,
    },
    {
      title: '5 · Decoder decision + recovery operation',
      body: describeCorrection(t.correction),
    },
    {
      title: '6 · Decoded and fidelity scored',
      body: `Inverse encoding circuit applied; decoded Bloch vector (x = ${t.decodedBloch.x.toFixed(3)}, y = ${t.decodedBloch.y.toFixed(3)}, z = ${t.decodedBloch.z.toFixed(3)}) → fidelity with the requested state = ${(t.fidelity * 100).toFixed(2)}%. The bare qubit took the identical noise and scored ${(t.fidelityBefore * 100).toFixed(2)}%.`,
    },
    {
      title: '7 · Logical measurement readout',
      body: `Z-basis readout of the decoded qubit returned |${t.measuredOutcome}⟩. ${t.detectionNote}`,
    },
    {
      title: '8 · Runtime and reproducibility',
      body: `Circuit simulation + decoding took ${t.elapsedMs} ms in-browser. Seed ${seed} + identical settings reproduce this exact shot (seeded mulberry32 RNG).`,
    },
  ];

  /** the 11-row output summary required by the project spec */
  const summaryRows = (t: ShotTrace): [string, string, string][] => {
    const encodedStr = t.encodedAmps.length
      ? t.encodedAmps.slice(0, 3).map((a) => `${a.label} ${(a.prob * 100).toFixed(1)}%`).join(' · ')
      : 'unitary encoding';
    const flagged = t.syndrome.filter((s) => s.bit).map((s) => s.label);
    return [
      ['Input and logical state', `${t.stateLabel} (input) → encoded block: ${encodedStr}`, 'Prepared |ψ⟩ and the encoded state that protects it'],
      ['Noise configuration', `${t.noiseName} · p = ${t.p.toFixed(3)} · ${t.noiseEvents.length ? 'hit: ' + t.noiseEvents.map((e) => `${e.kind}@q${e.qubit}`).join(', ') : 'no error sampled this shot'}`, 'Model, probability, affected qubits'],
      ['Syndrome', `[${t.syndrome.map((s) => s.bit).join(' ')}] — ${flagged.length ? 'defects: ' + flagged.join(', ') : 'all stabilizers +1 (trivial)'}`, 'Syndrome bits and their interpretation'],
      ['Correction', describeCorrection(t.correction), 'Detected error, decoder decision, recovery operation'],
      ['Measurement distribution', dist ? `|0⟩: ${dist.outcomeCounts.zero} · |1⟩: ${dist.outcomeCounts.one} (of ${dist.shots} shots)` : 'press “Run N shots” for the histogram', 'Counts for each measurement outcome'],
      ['Logical error rate', dist ? `${(dist.logicalErrorRate * 100).toFixed(2)}% — ${dist.successRule}` : 'run the distribution to measure', 'Fraction of trials with an incorrect decoded logical result'],
      ['Logical success rate', dist ? `${(dist.logicalSuccessRate * 100).toFixed(2)}%` : 'run the distribution to measure', 'Fraction of trials with a correct decoded logical result'],
      ['State fidelity', `this shot ${(t.fidelity * 100).toFixed(2)}%${dist ? ` · ${dist.shots}-shot average ${(dist.avgFidelityQEC * 100).toFixed(2)}%` : ''}`, 'How closely the recovered state matches the original'],
      ['Comparison', dist ? `QEC ${(dist.avgFidelityQEC * 100).toFixed(2)}% vs bare ${(dist.avgFidelityBare * 100).toFixed(2)}% — ${dist.avgFidelityBare > 1e-9 ? (((dist.avgFidelityQEC - dist.avgFidelityBare) * 100).toFixed(2) + ' points better') : 'identical'}` : `this shot: QEC ${(t.fidelity * 100).toFixed(2)}% vs bare ${(t.fidelityBefore * 100).toFixed(2)}%`, 'No QEC versus QEC (sweeps live in Performance Lab)'],
      ['Runtime', `circuit + decoding ${t.elapsedMs} ms${dist ? ` · ${dist.shots}-shot run ${dist.runtimeMs} ms (${dist.msPerShot.toFixed(2)} ms/shot)` : ''}`, 'Circuit simulation and decoding time'],
      ['Reproducibility', `seed ${seed} · ${dist ? `${dist.shots} shots · ` : 'single shot · '}${dist?.settings.engine ?? 'state-vector engine'} · ${NOISE_LABELS[noise]} p = ${p.toFixed(3)}`, 'Shots, random seed, simulator and model settings'],
    ];
  };

  const exportTraceReport = async (t: ShotTrace) => {
    const circuitPng = await svgToPngDataUrl(CIRCUIT_SVG_ID, 2);
    openPrintableReport(
      { title: `Single-Shot QEC Pipeline — ${t.codeName}`, runKind: 'Simulator Lab · Single Shot' },
      [
        {
          heading: 'Inputs (Experiment Configuration)',
          kv: configRows([
            ['Encoded state label', t.stateLabel],
            ['Encoding method', 'Unitary encoding circuit'],
          ]),
        },
        ...(circuitPng
          ? [
              {
                heading: 'Circuit — Full Pipeline (Input → Encode → Noise → Syndrome → Correct → Decode → Measure)',
                image: { dataUrl: circuitPng, caption: `The complete ${t.codeName} circuit as executed for this shot. Red lightning = sampled error; dashed boxes = conditional decoder corrections (the triggered one is highlighted); bottom register = classical syndrome bits + final result.` },
              },
            ]
          : []),
        {
          heading: 'Outputs (Results)',
          cards: [
            { label: 'Fidelity with QEC', value: (t.fidelity * 100).toFixed(2) + '%', tone: t.fidelity > 0.99 ? 'good' : t.fidelity > 0.9 ? 'neutral' : 'bad' },
            { label: 'Fidelity bare qubit', value: (t.fidelityBefore * 100).toFixed(2) + '%', tone: 'bad' },
            { label: 'Logical outcome', value: '|' + t.measuredOutcome + '⟩' },
            { label: 'Recovered', value: t.recovered ? 'YES' : 'PARTIAL', tone: t.recovered ? 'good' : 'bad' },
            { label: 'Engine time', value: t.elapsedMs + ' ms' },
          ],
        },
        {
          heading: 'Full Output Summary',
          table: {
            headers: ['Output', 'This run', 'Definition'],
            rows: summaryRows(t).map(([o, v, d]) => [o, v, d]),
          },
          note: dist ? `Distribution from ${dist.shots} independent shots · success rule: ${dist.successRule}.` : 'Distribution statistics (measurement counts, logical error/success rate) appear after pressing “Run N shots”.',
        },
        {
          heading: 'Pipeline Events',
          kv: [
            ['Noise events', t.noiseEvents.length ? t.noiseEvents.map((e) => e.detail).join('; ') : `None sampled at p = ${t.p.toFixed(3)}`],
            ['Syndrome', t.syndrome.map((s) => `${s.label}=${s.bit}`).join('  ')],
            ['Correction applied', t.correction.x.length || t.correction.z.length ? `X on q${t.correction.x.join(', q') || '—'} ; Z on q${t.correction.z.join(', q') || '—'}` : 'None needed'],
            ['Detection note', t.detectionNote],
          ],
        },
        {
          heading: 'Encoded State After Noise — Amplitudes',
          table: {
            headers: ['Basis state', 'Re', 'Im', 'Probability'],
            rows: t.afterNoiseAmps.map((a) => [a.label, a.re.toFixed(4), a.im.toFixed(4), (a.prob * 100).toFixed(2) + '%']),
          },
          note: 'Amplitudes below the 1% display threshold are omitted. Full data available via the JSON export.',
        },
        {
          heading: 'How This Result Was Computed — Full Walkthrough',
          steps: buildStepLog(t),
        },
        {
          heading: 'Methodology',
          text: `The shot executes the complete pipeline: encode |ψ⟩ into the [[${codeMeta.n},${codeMeta.k},${codeMeta.d}]] codespace, sample the selected noise channel via quantum trajectories, measure every stabilizer generator projectively, apply the table-driven decoder correction, decode, and compute the logical fidelity against the target pure state. The bare-qubit baseline receives the identical noise. Team: ${TEAM_NAMES.join(', ')}.`,
        },
      ]
    );
  };

  const exportTraceJSON = (t: ShotTrace) => {
    downloadJSON(`shot-${t.codeId}-${runId()}.json`, {
      experiment: 'Single-shot QEC pipeline',
      generatedAt: nowStamp(),
      team: TEAM_NAMES,
      inputs: Object.fromEntries(configRows()),
      outputs: {
        fidelity: t.fidelity,
        fidelityBare: t.fidelityBefore,
        recovered: t.recovered,
        measuredOutcome: t.measuredOutcome,
        noiseEvents: t.noiseEvents,
        syndrome: t.syndrome,
        syndromeInterpretation: describeSyndrome(svCode, t.syndrome.map((s) => s.bit)),
        correction: t.correction,
        correctionInterpretation: describeCorrection(t.correction),
        decodedBloch: t.decodedBloch,
        beforeBloch: t.beforeBloch,
        amplitudesAfterNoise: t.afterNoiseAmps,
        amplitudesEncoded: t.encodedAmps,
        elapsedMs: t.elapsedMs,
        detectionNote: t.detectionNote,
      },
      distribution: dist,
      howItCame: buildStepLog(t),
      reproducibility: { seed, engine: 'state-vector', code: t.codeId, noise: t.noiseId, p: t.p },
    });
  };

  const exportTraceCSV = (t: ShotTrace) => {
    downloadCSV(
      `amplitudes-${t.codeId}-${runId()}.csv`,
      ['basis_state', 'real', 'imag', 'probability'],
      t.afterNoiseAmps.map((a) => [a.label, a.re.toFixed(6), a.im.toFixed(6), a.prob.toFixed(6)])
    );
  };

  const exportDistCSV = (d: DistributionResult) => {
    downloadCSV(
      `distribution-${d.settings.codeId}-${runId()}.csv`,
      ['shots', 'outcome_zero', 'outcome_one', 'logical_error_rate', 'logical_success_rate', 'avg_fidelity_qec', 'avg_fidelity_bare', 'detection_rate', 'correction_rate', 'runtime_ms', 'seed', 'code', 'noise', 'p'],
      [[d.shots, d.outcomeCounts.zero, d.outcomeCounts.one, d.logicalErrorRate.toFixed(6), d.logicalSuccessRate.toFixed(6), d.avgFidelityQEC.toFixed(6), d.avgFidelityBare.toFixed(6), d.detectionRate.toFixed(6), d.correctionRate.toFixed(6), d.runtimeMs, d.settings.seed, d.settings.codeName, d.settings.noise, d.settings.p]]
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <HowToCard
        steps={[
          { title: 'Choose code + noise', body: 'Configuration panel below — every option has a ? button explaining it in plain language. The defaults match our Phase-1 worked example (3-qubit bit-flip, 10%).' },
          { title: 'Press Run Shot', body: 'One full pipeline runs: encode → noise → syndrome → correction → decode → measure. The FULL circuit is drawn large below, with your shot annotated on it.' },
          { title: 'Read the Results tab', body: 'The verdict card, the 11-row Output Summary and the distribution histogram show every requested output — input state, noise config, syndrome, correction, counts, rates, fidelity, runtime.' },
          { title: 'Export everything', body: 'Report (PDF) embeds the circuit image, inputs, outputs and the full step-by-step “how it came” walkthrough. PNG downloads the circuit image; JSON/CSV carry raw data.' },
        ]}
        tip="New to quantum error correction? Every input shows a one-line hint plus a ? button with the full story. Under depolarizing noise, try the Shor Code — it fixes any single error."
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      {/* ------------------------------ Control panel */}
      <div className="flex flex-col gap-4">
        <Card className="glass border-white/8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-violet-300">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <GuideField label="QEC Code" info={CODE_INFO} hint="One logical qubit protected by n physical ones. Depolarizing noise? Pick the Shor Code.">
              <Select value={codeId} onValueChange={switchCode}>
                <SelectTrigger className="w-full border-violet-400/25 bg-white/[0.04]"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {CODE_REGISTRY.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.short} · [[{c.n},{c.k},{c.d}]]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="border-violet-500/40 text-violet-300">[[{codeMeta.n},{codeMeta.k},{codeMeta.d}]]</Badge>
                <Badge variant="outline" className="border-slate-500/40 text-slate-400">rate {codeMeta.rate}</Badge>
                <Badge variant="outline" className="border-cyan-500/40 text-cyan-300">{codeMeta.stabilizerCount} stabilizers</Badge>
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">{codeMeta.corrects}</Badge>
              </div>
            </GuideField>

            <GuideField label="Noise Model" info={NOISE_INFO} hint="How qubits get disturbed in this experiment. Bit-Flip (X) is the classic first example.">
              <Select value={noise} onValueChange={(v) => setNoise(v as NoiseModelId)}>
                <SelectTrigger className="w-full border-violet-400/25 bg-white/[0.04]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {compatNoise.map((id) => (
                    <SelectItem key={id} value={id}>{NOISE_LABELS[id]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </GuideField>

            {(
              <GuideField
                label="Error probability p"
                info={P_INFO}
                hint="Chance each qubit is hit per shot. 10% is the Phase-1 example."
                right={<span className="font-mono text-violet-300">{p.toFixed(3)}</span>}
              >
                <Slider
                  value={[Math.round(p * 500)]}
                  min={0}
                  max={500}
                  step={1}
                  onValueChange={(v) => setP(v[0] / 500)}
                  className="text-violet-400"
                />
              </GuideField>
            )}

            <GuideField label="Input State |ψ⟩" info={STATE_INFO} hint="Where your qubit starts on the Bloch sphere. Presets are the classic points.">
              <div className="flex flex-wrap gap-1.5">
                {STATE_PRESETS.map((s) => (
                  <Button
                    key={s.label}
                    size="sm"
                    variant={statePreset === s.label ? 'default' : 'outline'}
                    className={statePreset === s.label ? 'bg-violet-600 hover:bg-violet-500' : 'border-violet-500/30 text-slate-300'}
                    onClick={() => applyPreset(s.label)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              {statePreset === 'Custom' && (
                <div className="mt-3 flex flex-col gap-3 rounded-lg border border-violet-500/20 p-3">
                  <GuideField label="θ (polar angle)" info={THETA_INFO} right={<span className="font-mono text-violet-300">{theta.toFixed(2)} rad</span>}>
                    <Slider value={[Math.round((theta / Math.PI) * 100)]} min={0} max={100} onValueChange={(v) => setTheta((v[0] / 100) * Math.PI)} />
                  </GuideField>
                  <GuideField label="φ (azimuth)" info={PHI_INFO} right={<span className="font-mono text-violet-300">{phi.toFixed(2)} rad</span>}>
                    <Slider value={[Math.round((phi / (2 * Math.PI)) * 100)]} min={0} max={100} onValueChange={(v) => setPhi((v[0] / 100) * 2 * Math.PI)} />
                  </GuideField>
                </div>
              )}
            </GuideField>

            <GuideField
              label="Manual Error Injection"
              info={MANUAL_INFO}
              hint="Click qubit buttons to cycle I→X→Z→Y"
            >
              <div className="flex items-center justify-between rounded-lg border border-violet-500/20 px-3 py-2">
                <span className="text-[11px] text-slate-400">{manualMode ? 'ON — your errors override random noise' : 'OFF — noise is sampled randomly'}</span>
                <Switch checked={manualMode} onCheckedChange={setManualMode} />
              </div>
            </GuideField>

            {manualMode && svCode && (
              <div className="rounded-lg border border-violet-500/20 p-3">
                <div className="mb-2 text-[11px] text-slate-400">Toggle error type per qubit (I → X → Z → Y):</div>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: svCode.n }, (_, q) => {
                    const st = manualErrors.get(`0,${q}`) ?? 0;
                    const label = ['I', 'X', 'Z', 'Y'][st];
                    const color = st === 0 ? 'border-slate-500/40 text-slate-400' : st === 1 ? 'border-rose-500/60 text-rose-400' : st === 2 ? 'border-amber-500/60 text-amber-400' : 'border-fuchsia-500/60 text-fuchsia-400';
                    return (
                      <Button
                        key={q}
                        size="sm"
                        variant="outline"
                        className={`h-8 w-9 font-mono ${color}`}
                        onClick={() => toggleInject(0, q, (st + 1) % 4)}
                      >
                        <span className="text-[9px] text-slate-500 mr-0.5">q{q}</span>{label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <GuideField label="RNG Seed" info={SEED_INFO} hint="Same seed = same result. Use the dice for a fresh random shot." right={<span className="font-mono text-violet-300">{seed}</span>}>
              <Slider value={[seed % 1000]} min={0} max={999} step={1} onValueChange={(v) => setSeed(v[0] * 7919 + 13)} />
            </GuideField>

            <div className="flex gap-2">
              <Button onClick={runShot} disabled={running} className="flex-1 bg-violet-600 hover:bg-violet-500">
                <Play className="mr-1.5 h-4 w-4" /> Run Shot
              </Button>
              <Button onClick={randomShot} disabled={running} variant="outline" className="border-violet-500/40 text-violet-300">
                <Dices className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------ Results panel */}
      <div className="flex flex-col gap-4">
        {!trace && (
          <Card className="glass border-dashed border-violet-400/25">
            <CardContent className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
                <Zap className="h-8 w-8 text-violet-400/70" />
              </div>
              <p className="max-w-sm text-sm text-slate-400">
                Configure a QEC code and noise model, then press <span className="text-violet-300">Run Shot</span> to
                step through the full error-correction pipeline — encoding, noise injection, syndrome extraction,
                correction, decoding and measurement, exactly as in our Phase-1 architecture. The complete large
                circuit is drawn and annotated for your shot.
              </p>
            </CardContent>
          </Card>
        )}

        {trace && (
          <>
            <PipelineRail stage={playStage} onReplay={startPlayback} />
            <div className="rise-in">
              <SVTraceView
                trace={trace}
                fullCircuit={fullCircuit}
                annotation={annotation}
                circuitFit={circuitFit}
                setCircuitFit={setCircuitFit}
                dist={dist}
                distShots={distShots}
                distRunning={distRunning}
                distProgress={distProgress}
                onDistShots={setDistShots}
                onRunDist={runDist}
                onReport={exportTraceReport}
                onJSON={exportTraceJSON}
                onCSV={exportTraceCSV}
                onDistCSV={exportDistCSV}
                onPNG={() => exportCircuitPNG(CIRCUIT_SVG_ID, `circuit-${trace.codeId}-${runId()}.png`)}
                onNavigate={onNavigate}
                seed={seed}
                summaryRows={summaryRows(trace)}
                stepLog={buildStepLog(trace)}
                svCode={svCode}
              />
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PipelineRail — animated stage-by-stage playback of the 6 pipeline   */
/* phases (v5). Lights up one stage at a time after each Run Shot,     */
/* then rests in the "all complete" state. One-shot, never loops.      */
/* ------------------------------------------------------------------ */

const RAIL_STAGES = [
  { label: 'Encode', icon: Cpu, hint: 'spread |ψ⟩ across physical qubits' },
  { label: 'Noise', icon: Zap, hint: 'sample the selected error channel' },
  { label: 'Syndrome', icon: ScanSearch, hint: 'stabilizer checks flag defects' },
  { label: 'Correct', icon: Wand2, hint: 'decoder-applied recovery gates' },
  { label: 'Decode', icon: CornerDownLeft, hint: 'un-encode back to 1 qubit' },
  { label: 'Measure', icon: Target, hint: 'read out + score the fidelity' },
];

function PipelineRail({ stage, onReplay }: {
  stage: number | null;
  onReplay: () => void;
}) {
  const playing = stage !== null && stage < RAIL_STAGES.length;
  const done = stage !== null && stage >= RAIL_STAGES.length;
  return (
    <div className="glass relative overflow-hidden rounded-xl px-4 py-3">
      {playing && (
        <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
          <div className="sweep-x h-full w-1/4 bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <span className="mr-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Pipeline · {done ? 'complete' : playing ? 'running…' : 'replay'}
        </span>
        {RAIL_STAGES.map((s, i) => {
          const Icon = s.icon;
          const isDone = done || (stage !== null && i < stage);
          const isActive = stage === i;
          return (
            <span key={s.label} className="flex items-center gap-1">
              <span
                title={s.hint}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-all duration-300 ${
                  isActive
                    ? 'stage-active border-cyan-300/70 bg-cyan-400/15 text-cyan-100'
                    : isDone
                      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                      : 'border-white/8 bg-white/[0.02] text-slate-500'
                }`}
              >
                {isDone && !isActive ? <CircleCheck className="h-3 w-3" /> : <Icon className={`h-3 w-3 ${isActive ? '' : 'opacity-70'}`} />}
                {s.label}
              </span>
              {i < RAIL_STAGES.length - 1 && (
                <span className={`h-px w-3 transition-colors duration-300 ${isDone ? 'bg-emerald-400/50' : 'bg-slate-700'}`} />
              )}
            </span>
          );
        })}
        <button
          onClick={onReplay}
          className="ml-auto flex items-center gap-1 rounded-md border border-violet-400/25 px-2 py-1 text-[10px] text-violet-300 transition-colors hover:bg-violet-500/15"
          aria-label="Replay pipeline animation"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-200';
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SVTraceView — everything the shot produces, with the 11-row         */
/* output summary, the large pipeline circuit and the distribution.    */
/* ------------------------------------------------------------------ */

interface SVTraceViewProps {
  trace: ShotTrace;
  fullCircuit: ReturnType<typeof buildFullCircuit>;
  annotation: ShotAnnotation | null;
  circuitFit: boolean;
  setCircuitFit: (v: boolean) => void;
  dist: DistributionResult | null;
  distShots: number;
  distRunning: boolean;
  distProgress: number;
  onDistShots: (n: number) => void;
  onRunDist: () => void;
  onReport: (t: ShotTrace) => void;
  onJSON: (t: ShotTrace) => void;
  onCSV: (t: ShotTrace) => void;
  onDistCSV: (d: DistributionResult) => void;
  onPNG: () => void;
  onNavigate?: (tab: string) => void;
  seed: number;
  summaryRows: [string, string, string][];
  stepLog: { title: string; body: string }[];
  svCode: ReturnType<typeof getSVCode>;
}

function SVTraceView(props: SVTraceViewProps) {
  const { trace: trace, fullCircuit, annotation, circuitFit, setCircuitFit, dist, distShots, distRunning, distProgress, onDistShots, onRunDist, onReport, onJSON, onCSV, onDistCSV, onPNG, onNavigate, seed, summaryRows, stepLog } = props;
  const steps = [
    { n: 1, title: 'Encoding', detail: 'Unitary encoding circuit applied', ok: true },
    {
      n: 2, title: 'Noise',
      detail: trace.noiseEvents.length
        ? trace.noiseEvents.map((e) => e.detail).join('  •  ')
        : `No error sampled this shot (p = ${trace.p.toFixed(3)} per qubit)`,
      ok: trace.noiseEvents.length === 0,
    },
    {
      n: 3, title: 'Syndrome Extraction',
      detail: trace.syndrome.some((s) => s.bit)
        ? `Defects: ${trace.syndrome.filter((s) => s.bit).map((s) => s.label).join(', ')}`
        : 'All stabilizers +1 — trivial syndrome',
      ok: !trace.syndrome.some((s) => s.bit),
    },
    {
      n: 4, title: 'Correction',
      detail: trace.correction.x.length || trace.correction.z.length
        ? `Applied X on q${trace.correction.x.join(', q')} ${trace.correction.z.length ? ` and Z on q${trace.correction.z.join(', q')}` : ''}`
        : 'No correction needed',
      ok: true,
    },
    { n: 5, title: 'Decoding', detail: 'Inverse encoding circuit applied', ok: true },
    { n: 6, title: 'Measurement', detail: `Logical outcome: |${trace.measuredOutcome}⟩ — ${trace.detectionNote}`, ok: trace.recovered },
  ];

  return (
    <ResultTabs
      results={
        <>
      {/* verdict */}
      <Card className={`border ${trace.recovered ? 'border-emerald-400/40 bg-emerald-400/[0.05]' : 'border-amber-400/40 bg-amber-400/[0.05]'}`}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            {trace.recovered ? <CircleCheck className="h-7 w-7 text-emerald-400" /> : <CircleX className="h-7 w-7 text-amber-400" />}
            <div>
              <div className="font-semibold text-slate-100">
                {trace.recovered ? 'Quantum information recovered' : 'Imperfect recovery (see fidelity)'}
              </div>
              <div className="text-xs text-slate-400">
                {trace.codeName} · {trace.noiseName} · p = {trace.p.toFixed(3)} · seed trace in {trace.elapsedMs} ms
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Stat label="Fidelity (with QEC)" value={(trace.fidelity * 100).toFixed(2) + '%'} tone={trace.fidelity > 0.99 ? 'good' : trace.fidelity > 0.9 ? 'neutral' : 'bad'} />
            <Stat label="Fidelity (bare qubit)" value={(trace.fidelityBefore * 100).toFixed(2) + '%'} />
            <Stat label="Logical outcome" value={'|' + trace.measuredOutcome + '⟩'} />
          </div>
          <div className="flex w-full flex-wrap gap-2 border-t border-violet-500/15 pt-3">
            <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10" onClick={() => onReport(trace)}>
              <FileText className="mr-1 h-3.5 w-3.5" /> Export Report (PDF + circuit)
            </Button>
            <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300 hover:bg-sky-500/10" onClick={onPNG}>
              <ImageDown className="mr-1 h-3.5 w-3.5" /> Circuit PNG
            </Button>
            <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10" onClick={() => onJSON(trace)}>
              <Braces className="mr-1 h-3.5 w-3.5" /> JSON
            </Button>
            <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10" onClick={() => onCSV(trace)}>
              <Braces className="mr-1 h-3.5 w-3.5" /> CSV (amplitudes)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* -------- FULL OUTPUT SUMMARY (the 11-row spec) -------- */}
      <Card className="glass border-cyan-500/25">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-cyan-200">
            <ListOrdered className="h-4 w-4" /> Full Output Summary — every requested output for this run
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-white/8">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03]">
                  <th className="px-3 py-2 font-semibold text-slate-400">Output</th>
                  <th className="px-3 py-2 font-semibold text-slate-400">This run</th>
                  <th className="px-3 py-2 font-semibold text-slate-400">What it is</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map(([out, val, def], i) => (
                  <tr key={out} className={`border-b border-white/5 ${i % 2 ? 'bg-white/[0.015]' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-slate-200">{out}</td>
                    <td className="px-3 py-2 font-mono text-[11px] leading-relaxed text-cyan-100">{val}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">{def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* -------- FULL PIPELINE CIRCUIT (large) -------- */}
      <Card className="glass border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
            <Cpu className="h-4 w-4 text-violet-300" /> Full Pipeline Circuit — {fullCircuit.codeName}
            <span className="text-xs font-normal text-slate-500">
              ({fullCircuit.nData} data + {fullCircuit.nAnc} ancilla qubits · {fullCircuit.nClassical} classical bits)
            </span>
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300" onClick={() => setCircuitFit(!circuitFit)}>
                {circuitFit ? <Minimize2 className="mr-1 h-3.5 w-3.5" /> : <Maximize2 className="mr-1 h-3.5 w-3.5" />}
                {circuitFit ? 'Actual size' : 'Fit width'}
              </Button>
              <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-300" onClick={onPNG}>
                <ImageDown className="mr-1 h-3.5 w-3.5" /> PNG
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CircuitDiagram
            circuit={fullCircuit}
            annotation={annotation}
            fitWidth={circuitFit}
            maxBodyHeight={640}
            svgId={CIRCUIT_SVG_ID}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-400" />red = sampled error (ID slot hit)</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />green dashed = conditional X correction</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-400" />amber dashed = conditional Z correction</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-300" />double line = classical syndrome register</span>
            <span>a0… = ancilla (syndrome) qubits</span>
          </div>
        </CardContent>
      </Card>

      {/* -------- DISTRIBUTION + COMPARISON -------- */}
      <Card className="glass border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
            <BarChart3 className="h-4 w-4 text-cyan-300" /> Measurement Distribution &amp; Comparison
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {[100, 200, 500, 1000].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={distShots === n ? 'default' : 'outline'}
                  className={distShots === n ? 'bg-cyan-600 hover:bg-cyan-500' : 'border-cyan-500/30 text-cyan-300'}
                  onClick={() => onDistShots(n)}
                >
                  {n}
                </Button>
              ))}
              <Button size="sm" className="bg-cyan-600 hover:bg-cyan-500" onClick={onRunDist} disabled={distRunning}>
                <Play className="mr-1 h-3.5 w-3.5" /> {distRunning ? `Running… ${distProgress}%` : `Run ${distShots} shots`}
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dist ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">Measurement distribution — counts of each logical outcome over {dist.shots} shots</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={[{ name: '|0⟩', shots: dist.outcomeCounts.zero }, { name: '|1⟩', shots: dist.outcomeCounts.one }]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2c2750" />
                      <XAxis dataKey="name" tick={{ fill: '#8b85ad', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#8b85ad', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#181430', border: '1px solid #4c4470', borderRadius: 8, color: '#e2e8f0' }} />
                      <Bar dataKey="shots" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">No QEC vs QEC — average state fidelity over the same {dist.shots} shots</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={[
                      { name: 'Fidelity', 'With QEC': dist.avgFidelityQEC * 100, 'Bare qubit': dist.avgFidelityBare * 100 },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2c2750" />
                      <XAxis dataKey="name" tick={{ fill: '#8b85ad', fontSize: 12 }} />
                      <YAxis tick={{ fill: '#8b85ad', fontSize: 11 }} unit="%" domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: '#181430', border: '1px solid #4c4470', borderRadius: 8, color: '#e2e8f0' }} formatter={(v: number) => `${Number(v).toFixed(2)}%`} />
                      <Legend wrapperStyle={{ color: '#8b85ad' }} />
                      <Bar dataKey="With QEC" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Bare qubit" fill="#f472b6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Top syndrome patterns</div>
                  <div className="flex flex-wrap gap-1.5">
                    {dist.syndromeCounts.map((s) => (
                      <span key={s.pattern} className={`rounded-md border px-2 py-1 font-mono text-[11px] ${s.stable ? 'border-slate-600/40 bg-slate-800/30 text-slate-400' : 'border-rose-500/50 bg-rose-500/10 text-rose-300'}`}>
                        [{s.pattern}] × {s.count}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Logical success" value={(dist.logicalSuccessRate * 100).toFixed(2) + '%'} tone="good" />
                  <Stat label="Logical error" value={(dist.logicalErrorRate * 100).toFixed(2) + '%'} tone={dist.logicalErrorRate < 0.02 ? 'neutral' : 'bad'} />
                  <Stat label="Detected / corrected" value={`${(dist.detectionRate * 100).toFixed(1)}% / ${(dist.correctionRate * 100).toFixed(1)}%`} />
                  <Stat label="Runtime" value={`${dist.runtimeMs} ms · ${dist.msPerShot.toFixed(2)} ms/shot`} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>Success rule: {dist.successRule}.</span>
                <Button size="sm" variant="ghost" className="text-cyan-400" onClick={() => onDistCSV(dist)}>
                  <Braces className="mr-1 h-3 w-3" /> CSV (distribution)
                </Button>
                <Button size="sm" variant="ghost" className="text-cyan-400" onClick={() => onNavigate?.('performance')}>
                  Full sweeps in Performance Lab →
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Press <span className="text-cyan-300">Run {distShots} shots</span> to fill in the measurement histogram, logical error/success
              rates, the QEC-vs-bare comparison and the runtime statistics — all with the same seed ({seed}) for reproducibility.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bloch spheres */}
        <Card className="glass border-white/8">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-200">Logical State Comparison</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-around">
              <BlochSphere bloch={trace.decodedBloch} label={`After QEC — F = ${(trace.fidelity * 100).toFixed(1)}%`} color="#a78bfa" />
              <BlochSphere bloch={trace.beforeBloch} label={`Bare qubit — F = ${(trace.fidelityBefore * 100).toFixed(1)}%`} color="#f472b6" />
            </div>
          </CardContent>
        </Card>

        {/* syndrome table */}
        <Card className="glass border-white/8">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-200">Syndrome Table</CardTitle></CardHeader>
          <CardContent>
            <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              {trace.syndrome.map((s) => (
                <div
                  key={s.label}
                  className={`flex items-center justify-between rounded-md border px-2 py-1.5 font-mono text-xs ${
                    s.bit ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' : 'border-slate-600/30 bg-slate-800/30 text-slate-400'
                  }`}
                >
                  <span>{s.label}</span>
                  <span className="font-semibold">{s.bit}</span>
                </div>
              ))}
            </div>
            <Separator className="my-3 bg-white/10" />
            <div className="text-[11px] text-slate-500">{describeSyndrome(props.svCode, trace.syndrome.map((s) => s.bit))}</div>
          </CardContent>
        </Card>
      </div>

      {/* state inspector */}
      <Card className="glass border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200">
            Encoded State After Noise — |ψ⟩ = {trace.stateLabel}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1 font-mono text-xs">
            {trace.afterNoiseAmps.length === 0 && <div className="text-slate-500">All amplitude below display threshold.</div>}
            {trace.afterNoiseAmps.map((a) => (
              <div key={a.label} className="flex items-center gap-2">
                <span className="w-24 text-cyan-300">{a.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-slate-800">
                  <div className="h-full rounded bg-gradient-to-r from-violet-500 to-cyan-400" style={{ width: `${Math.min(100, a.prob * 100)}%` }} />
                </div>
                <span className="w-20 text-right text-slate-400">{(a.prob * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
        </>
      }
      how={
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-slate-400">
            This is the exact sequence the engine executed for YOUR shot — every value below comes from this run
            ({trace.codeName} · {trace.noiseName} · p = {trace.p.toFixed(3)}).
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {steps.map((s) => (
              <Card key={s.n} className="glass border-white/8">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-600/25 font-mono text-xs text-cyan-300">{s.n}</span>
                    <span className="text-slate-200">{s.title}</span>
                    {s.ok ? <CircleCheck className="ml-auto h-4 w-4 text-emerald-400" /> : <CircleX className="ml-auto h-4 w-4 text-rose-400" />}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-xs leading-relaxed text-slate-400">{s.detail}</CardContent>
              </Card>
            ))}
          </div>
          <div className="glass rounded-xl border-cyan-400/20 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
              <ListOrdered className="h-4 w-4" /> Step-by-step — how every number came out (same log the PDF export carries)
            </div>
            <ol className="flex flex-col gap-2.5">
              {stepLog.map((s) => (
                <li key={s.title} className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                  <div className="text-[11px] font-semibold text-cyan-100">{s.title}</div>
                  <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-slate-400">{s.body}</div>
                </li>
              ))}
            </ol>
          </div>
          <MeaningCard tone="info" title="Where the numbers come from">
            <p>Fidelity is computed from the decoded quantum state itself: F = ⟨ψ_target|ρ_decoded|ψ_target⟩ — the squared overlap between what you asked for and what you got. The syndrome comes from projective stabilizer measurements; the correction comes from a pre-computed lookup table mapping each syndrome pattern to the most likely error. The encoded block and the bare qubit share the same random seed, so the before/after comparison is exact.</p>
            <p className="mt-2">Engine time for this shot: <span className="font-mono text-cyan-300">{trace.elapsedMs} ms</span> — everything ran locally in your browser.</p>
          </MeaningCard>
        </div>
      }
      meaning={
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <MeaningCard tone="info" title="Fidelity — your headline number">
              <p>Fidelity measures how close the recovered state is to what you asked for: 100% = identical, 0% = completely different. Rule of thumb: ≥ 99% excellent recovery · 90–99% good · 50–90% heavily damaged · below 50% the state was likely lost.</p>
              <p className="mt-2">This run: <span className="font-mono text-emerald-300">{(trace.fidelity * 100).toFixed(2)}%</span> {trace.fidelity > 0.99 ? '— excellent recovery.' : trace.fidelity > 0.9 ? '— good recovery with minor damage.' : '— significant damage; try a stronger code or less noise.'}</p>
            </MeaningCard>
            <MeaningCard tone="violet" title="QEC vs bare — the gap is the whole point">
              <p>The bare-qubit number is the SAME noise hitting ONE unprotected qubit. The gap between the two numbers is exactly what error correction bought you.</p>
              <p className="mt-2">This shot: <span className="font-mono text-emerald-300">{(trace.fidelity * 100).toFixed(1)}%</span> vs <span className="font-mono text-rose-300">{(trace.fidelityBefore * 100).toFixed(1)}%</span> — a difference of <span className="font-mono text-cyan-300">{((trace.fidelity - trace.fidelityBefore) * 100).toFixed(1)} points</span>.</p>
            </MeaningCard>
            <MeaningCard tone="warn" title={trace.recovered ? 'Full recovery — what happened' : 'Partial recovery — why it happens'}>
              {trace.recovered
                ? 'The decoder identified the exact error from the syndrome and cancelled it completely. The measured logical qubit equals your input state.'
                : `The decoded state is close but imperfect — most often because two or more errors landed in the same shot, which a distance-3 code cannot fully reverse. Try a lower p, or compare codes. Engine note: ${trace.detectionNote}`}
            </MeaningCard>
            <MeaningCard tone="good" title="The syndrome — error clues without spying">
              Measuring the data qubits directly would destroy the superposition you are protecting. Stabilizer checks answer only “do these neighbours DISAGREE?” — enough to locate the error while the quantum information stays untouched. That indirectness is the central trick of quantum error correction.
            </MeaningCard>
          </div>
          <TryBox>
            Raise the noise slider until the QEC fidelity drops toward the bare number — that is this code&apos;s pain point. Then switch codes at the same noise and compare — under depolarizing noise the Shor Code [[9,1,3]] survives single X, Y AND Z errors. For continuous protection, open the 3D Quantum Lab and watch live correction rounds on the Bloch sphere.
          </TryBox>
        </>
      }
    />
  );
}
