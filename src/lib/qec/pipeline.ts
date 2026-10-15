/**
 * Monte Carlo pipeline: single-shot traces for UI + bulk Monte Carlo + parameter sweeps
 * + N-shot measurement distributions for the full output summary.
 *
 * SCOPE — drives the QEC codes (bit-flip, phase-flip, Shor) × three noise channels of
 * all_with_noise_prob.py through the verified state-vector engine.
 */

import { makeRng, StateVector, RNG, GATES, blochFromRho } from './engine';
import {
  SVCodeDef, ShotOptions, runShot,
  fidelityFromRho, lookupCorrection,
} from './codes';
import { NoiseModelId, NoiseParams, applyNoiseLayer, getNoiseModel } from './noise';

// ---------------------------------------------------------------------------
// Live multi-round simulation (powers the real-time 3D labs)
// ---------------------------------------------------------------------------

export interface LiveRoundResult {
  /** Round index, filled in by the caller (kept optional for API stability). */
  round?: number;
  noiseEvents: { kind: string; qubit: number }[];
  syndrome: { label: string; bit: number }[];
  correction: { x: number[]; z: number[] };
  detected: boolean;
  bloch: { x: number; y: number; z: number };
  fidelity: number;
  amplitudes: { label: string; re: number; im: number; prob: number }[];
}

/** Prepare |ψ(θ,φ)⟩ and encode it once into the code's codespace. */
export function prepareEncodedState(code: SVCodeDef, theta: number, phi: number): StateVector {
  const sv = new StateVector(code.n);
  sv.prepareQubit0(theta, phi);
  for (const op of code.encoding) sv.applyGateOp(op.gate, op.qubits, op.param);
  return sv;
}

/**
 * One error-correction round on an ALREADY-ENCODED state vector:
 * noise → syndrome extraction → correction → logical readout.
 * The encoded state survives (unitary codes are re-encoded after readout),
 * so this can be called repeatedly for multi-round live simulations.
 */
export function runLiveRound(
  code: SVCodeDef,
  sv: StateVector,
  noise: NoiseModelId,
  params: NoiseParams,
  rng: RNG,
  theta: number,
  phi: number,
  correct = true
): LiveRoundResult {
  const events = applyNoiseLayer(sv, noise, params, rng);

  const syndrome: { label: string; bit: number }[] = [];
  let correction = { x: [] as number[], z: [] as number[] };
  if (correct) {
    for (const st of code.stabilizers) {
      const { outcome } = sv.measurePauli(st.paulis, rng, false);
      syndrome.push({ label: st.label, bit: outcome === -1 ? 1 : 0 });
    }

    const bits = syndrome.map((s) => s.bit);
    if (bits.some((b) => b === 1)) {
      correction = lookupCorrection(code, bits);
      for (const q of correction.x) sv.applyGate1(q, GATES.X);
      for (const q of correction.z) sv.applyGate1(q, GATES.Z);
    }
  }

  const rho: number[] = (() => {
    for (const op of code.decoding) sv.applyGateOp(op.gate, op.qubits, op.param);
    const out = sv.partialTraceQ0();
    for (const op of code.encoding) sv.applyGateOp(op.gate, op.qubits, op.param); // restore encoded state
    return out;
  })();

  return {
    bloch: blochFromRho(rho),
    fidelity: fidelityFromRho(rho, theta, phi),
    syndrome,
    correction,
    detected: syndrome.some((s) => s.bit === 1),
    noiseEvents: events.map((e) => ({ kind: e.kind, qubit: e.qubit })),
    amplitudes: sv.topAmplitudes(0.008, 8),
  };
}

/** One noise round on a bare (unprotected) qubit — the comparison trajectory. */
export function runBareRound(
  bare: StateVector,
  noise: NoiseModelId,
  params: NoiseParams,
  rng: RNG,
  theta: number,
  phi: number
): { bloch: { x: number; y: number; z: number }; fidelity: number } {
  applyNoiseLayer(bare, noise, params, rng);
  const rho = bare.partialTraceQ0();
  return { bloch: blochFromRho(rho), fidelity: fidelityFromRho(rho, theta, phi) };
}


// ---------------------------------------------------------------------------
// Monte Carlo for state-vector codes
// ---------------------------------------------------------------------------

export interface MCAccum {
  shots: number;
  fidelitySum: number;
  fidelityBeforeSum: number;
  detectedCount: number;
  correctedCount: number;
  failCount: number; // fidelity < 0.5 (severe logical corruption)
}

function newAccum(): MCAccum {
  return { shots: 0, fidelitySum: 0, fidelityBeforeSum: 0, detectedCount: 0, correctedCount: 0, failCount: 0 };
}

export function mcShot(code: SVCodeDef, opts: ShotOptions, rng: RNG, accum: MCAccum) {
  const res = runShot(code, opts, rng);
  // bare-qubit baseline: same noise on a single unprotected qubit
  const bare = new StateVector(1);
  bare.prepareQubit0(opts.theta, opts.phi);
  let fBefore: number;
  if (opts.forcedErrors && opts.forcedErrors.length > 0) {
    for (const fe of opts.forcedErrors) {
      if (fe.x && fe.z) bare.applyGateOp('Y', [0]);
      else if (fe.x) bare.applyGateOp('X', [0]);
      else if (fe.z) bare.applyGateOp('Z', [0]);
    }
    fBefore = fidelityFromRho(bare.partialTraceQ0(), opts.theta, opts.phi);
  } else {
    applyNoiseLayer(bare, opts.noise, opts.params, rng);
    fBefore = fidelityFromRho(bare.partialTraceQ0(), opts.theta, opts.phi);
  }
  accum.shots++;
  accum.fidelitySum += res.fidelity;
  accum.fidelityBeforeSum += fBefore;
  if (res.detected) accum.detectedCount++;
  if (res.correction.x.length > 0 || res.correction.z.length > 0) accum.correctedCount++;
  if (res.fidelity < 0.5) accum.failCount++;
  return res;
}

export interface MCResult {
  shots: number;
  fidelityQEC: number;
  fidelityBefore: number;
  errorRateQEC: number;
  errorRateBefore: number;
  improvement: number;
  detectionRate: number;
  correctionRate: number;
  failureRate: number;
  elapsedMs: number;
}

export function mcRun(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pMeas = 0
): MCResult {
  const rng = makeRng(seed);
  const accum = newAccum();
  const t0 = Date.now();
  for (let i = 0; i < shots; i++) {
    mcShot(code, { theta, phi, noise, params, pMeas }, rng, accum);
  }
  const elapsedMs = Date.now() - t0;
  const fQ = accum.fidelitySum / accum.shots;
  const fB = accum.fidelityBeforeSum / accum.shots;
  const errQ = 1 - fQ;
  const errB = 1 - fB;
  return {
    shots: accum.shots,
    fidelityQEC: fQ,
    fidelityBefore: fB,
    errorRateQEC: errQ,
    errorRateBefore: errB,
    improvement: errQ > 1e-9 ? errB / errQ : errB > 1e-9 ? Infinity : 1,
    detectionRate: accum.detectedCount / accum.shots,
    correctionRate: accum.correctedCount / accum.shots,
    failureRate: accum.failCount / accum.shots,
    elapsedMs,
  };
}

/** Chunked async Monte Carlo with progress callback (keeps the UI responsive). */
export async function mcRunAsync(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pMeas: number,
  onProgress: (done: number, total: number) => void,
  chunkSize = 25
): Promise<MCResult> {
  const rng = makeRng(seed);
  const accum = newAccum();
  const t0 = Date.now();
  let done = 0;
  while (done < shots) {
    const n = Math.min(chunkSize, shots - done);
    for (let i = 0; i < n; i++) {
      mcShot(code, { theta, phi, noise, params, pMeas }, rng, accum);
    }
    done += n;
    onProgress(done, shots);
    await new Promise((r) => setTimeout(r, 0));
  }
  const elapsedMs = Date.now() - t0;
  const fQ = accum.fidelitySum / accum.shots;
  const fB = accum.fidelityBeforeSum / accum.shots;
  const errQ = 1 - fQ;
  const errB = 1 - fB;
  return {
    shots: accum.shots,
    fidelityQEC: fQ,
    fidelityBefore: fB,
    errorRateQEC: errQ,
    errorRateBefore: errB,
    improvement: errQ > 1e-9 ? errB / errQ : errB > 1e-9 ? Infinity : 1,
    detectionRate: accum.detectedCount / accum.shots,
    correctionRate: accum.correctedCount / accum.shots,
    failureRate: accum.failCount / accum.shots,
    elapsedMs,
  };
}

/** Partial running statistics streamed to the UI during a Monte Carlo run. */
export interface PartialMC {
  done: number;
  total: number;
  fidelityQEC: number;
  fidelityBefore: number;
  errorRateQEC: number;
  errorRateBefore: number;
  detectionRate: number;
  correctionRate: number;
  failCount: number;
}

/**
 * Streaming Monte Carlo (v5): identical physics to mcRun, but every chunk it
 * hands the CURRENT running averages to onPartial — so the UI can show the
 * estimates converging live while the simulation is still running.
 */
export async function mcRunStreaming(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pMeas: number,
  onPartial: (s: PartialMC) => void,
  chunkSize = 80
): Promise<MCResult> {
  const rng = makeRng(seed);
  const accum = newAccum();
  const t0 = Date.now();
  let done = 0;
  while (done < shots) {
    const n = Math.min(chunkSize, shots - done);
    for (let i = 0; i < n; i++) {
      mcShot(code, { theta, phi, noise, params, pMeas }, rng, accum);
    }
    done += n;
    const fQ = accum.fidelitySum / accum.shots;
    const fB = accum.fidelityBeforeSum / accum.shots;
    onPartial({
      done: accum.shots,
      total: shots,
      fidelityQEC: fQ,
      fidelityBefore: fB,
      errorRateQEC: 1 - fQ,
      errorRateBefore: 1 - fB,
      detectionRate: accum.detectedCount / accum.shots,
      correctionRate: accum.correctedCount / accum.shots,
      failCount: accum.failCount,
    });
    await new Promise((r) => setTimeout(r, 0));
  }
  const elapsedMs = Date.now() - t0;
  const fQ = accum.fidelitySum / accum.shots;
  const fB = accum.fidelityBeforeSum / accum.shots;
  const errQ = 1 - fQ;
  const errB = 1 - fB;
  return {
    shots: accum.shots,
    fidelityQEC: fQ,
    fidelityBefore: fB,
    errorRateQEC: errQ,
    errorRateBefore: errB,
    improvement: errQ > 1e-9 ? errB / errQ : errB > 1e-9 ? Infinity : 1,
    detectionRate: accum.detectedCount / accum.shots,
    correctionRate: accum.correctedCount / accum.shots,
    failureRate: accum.failCount / accum.shots,
    elapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

export interface SweepPoint {
  p: number;
  fidelityQEC: number;
  fidelityBefore: number;
  errorRateQEC: number;
  errorRateBefore: number;
  improvement: number;
}

export function sweepSV(
  code: SVCodeDef,
  noise: NoiseModelId,
  baseParams: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pValues: number[],
  /** optional per-point params (kept for API stability) */
  paramsFor?: (p: number) => NoiseParams
): SweepPoint[] {
  const points: SweepPoint[] = [];
  for (const p of pValues) {
    const params: NoiseParams = paramsFor ? paramsFor(p) : { ...baseParams, p };
    const r = mcRun(code, noise, params, theta, phi, shots, seed + Math.floor(p * 100000));
    points.push({
      p,
      fidelityQEC: r.fidelityQEC,
      fidelityBefore: r.fidelityBefore,
      errorRateQEC: r.errorRateQEC,
      errorRateBefore: r.errorRateBefore,
      improvement: r.improvement,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Measurement distribution (N-shot run powering the full output summary)
// ---------------------------------------------------------------------------

export interface DistributionResult {
  shots: number;
  /** counts of each final measurement outcome */
  outcomeCounts: { zero: number; one: number };
  /** most common syndrome patterns with counts */
  syndromeCounts: { pattern: string; count: number; stable: boolean }[];
  avgFidelityQEC: number;
  avgFidelityBare: number;
  /** fraction of trials with an INCORRECT decoded logical result */
  logicalErrorRate: number;
  /** fraction of trials with a CORRECT decoded logical result */
  logicalSuccessRate: number;
  /** definition used for correct/incorrect (basis-state vs fidelity rule) */
  successRule: string;
  detectionRate: number;
  correctionRate: number;
  /** total wall time for the N-shot circuit simulation + decoding, ms */
  runtimeMs: number;
  msPerShot: number;
  /** reproducibility block */
  settings: {
    codeId: string;
    codeName: string;
    noise: NoiseModelId;
    p: number;
    pMeas: number;
    seed: number;
    engine: string;
  };
}

/**
 * Run `shots` full pipeline repetitions with one seeded RNG and tally the
 * complete statistics block requested for the simulator output summary:
 * measurement distribution, syndrome patterns, logical error/success rate,
 * average state fidelity (QEC vs bare), runtime and reproducibility settings.
 *
 * Success rule —
 *  - basis-state input (|0> / |1>): a trial is CORRECT when the measured
 *    logical bit equals the input bit (exactly the Python reference rule).
 *  - superposition input: a trial is CORRECT when the decoded state fidelity
 *    is >= 0.5 (the recovered state is closer to the target than to the
 *    orthogonal state).
 */
export function runDistribution(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pMeas = 0
): DistributionResult {
  const rng = makeRng(seed);
  const t0 = Date.now();
  const outcomeCounts = { zero: 0, one: 0 };
  const syndromeMap = new Map<string, number>();
  let fidelitySum = 0;
  let bareSum = 0;
  let successCount = 0;
  let detectedCount = 0;
  let correctedCount = 0;

  const isBasis = theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6;
  const basisBit = theta < Math.PI / 2 ? 0 : 1;

  for (let i = 0; i < shots; i++) {
    const res = runShot(code, { theta, phi, noise, params, pMeas }, rng);

    // final Z-basis readout of the decoded qubit
    const outcome: 0 | 1 = rng() < res.rho[6] ? 1 : 0;
    outcomeCounts[outcome === 0 ? 'zero' : 'one']++;

    // syndrome pattern tally
    const sKey = res.syndrome.join('');
    syndromeMap.set(sKey, (syndromeMap.get(sKey) ?? 0) + 1);

    // success / failure of THIS trial
    const correct = isBasis ? outcome === basisBit : res.fidelity >= 0.5;
    if (correct) successCount++;

    // bare-qubit baseline with the identical channel + RNG stream
    const bare = new StateVector(1);
    bare.prepareQubit0(theta, phi);
    applyNoiseLayer(bare, noise, params, rng);
    bareSum += fidelityFromRho(bare.partialTraceQ0(), theta, phi);

    if (res.detected) detectedCount++;
    if (res.correction.x.length > 0 || res.correction.z.length > 0) correctedCount++;
  }

  const runtimeMs = Date.now() - t0;
  const successRule = isBasis
    ? `measured logical bit equals the input bit (${basisBit}) — the all_with_noise_prob.py rule`
    : 'per-trial state fidelity ≥ 0.5 (decoded state closer to the target than to the orthogonal state)';

  const syndromeCounts = [...syndromeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([pattern, count]) => ({ pattern, count, stable: pattern.split('').every((b) => b === '0') }));

  return {
    shots,
    outcomeCounts,
    syndromeCounts,
    avgFidelityQEC: fidelitySum / shots,
    avgFidelityBare: bareSum / shots,
    logicalErrorRate: 1 - successCount / shots,
    logicalSuccessRate: successCount / shots,
    successRule,
    detectionRate: detectedCount / shots,
    correctionRate: correctedCount / shots,
    runtimeMs,
    msPerShot: runtimeMs / shots,
    settings: {
      codeId: code.id,
      codeName: code.name,
      noise,
      p: params.p,
      pMeas,
      seed,
      engine: 'Client-side state-vector simulator (seeded mulberry32 RNG)',
    },
  };
}

/**
 * Chunked ASYNC version of runDistribution — identical statistics, but yields
 * to the event loop between chunks so the UI stays responsive, with a live
 * progress callback.
 */
export async function runDistributionAsync(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  shots: number,
  seed: number,
  pMeas: number,
  onProgress: (done: number, total: number) => void,
  chunkSize = 40
): Promise<DistributionResult> {
  const rng = makeRng(seed);
  const t0 = Date.now();
  const outcomeCounts = { zero: 0, one: 0 };
  const syndromeMap = new Map<string, number>();
  let fidelitySum = 0;
  let bareSum = 0;
  let successCount = 0;
  let detectedCount = 0;
  let correctedCount = 0;

  const isBasis = theta < 1e-6 || Math.abs(theta - Math.PI) < 1e-6;
  const basisBit = theta < Math.PI / 2 ? 0 : 1;

  let done = 0;
  while (done < shots) {
    const n = Math.min(chunkSize, shots - done);
    for (let i = 0; i < n; i++) {
      const res = runShot(code, { theta, phi, noise, params, pMeas }, rng);
      const outcome: 0 | 1 = rng() < res.rho[6] ? 1 : 0;
      outcomeCounts[outcome === 0 ? 'zero' : 'one']++;
      const sKey = res.syndrome.join('');
      syndromeMap.set(sKey, (syndromeMap.get(sKey) ?? 0) + 1);
      const correct = isBasis ? outcome === basisBit : res.fidelity >= 0.5;
      if (correct) successCount++;
      const bare = new StateVector(1);
      bare.prepareQubit0(theta, phi);
      applyNoiseLayer(bare, noise, params, rng);
      bareSum += fidelityFromRho(bare.partialTraceQ0(), theta, phi);
      if (res.detected) detectedCount++;
      if (res.correction.x.length > 0 || res.correction.z.length > 0) correctedCount++;
    }
    done += n;
    onProgress(done, shots);
    await new Promise((r) => setTimeout(r, 0));
  }

  const runtimeMs = Date.now() - t0;
  const successRule = isBasis
    ? `measured logical bit equals the input bit (${basisBit}) — the all_with_noise_prob.py rule`
    : 'per-trial state fidelity ≥ 0.5 (decoded state closer to the target than to the orthogonal state)';

  const syndromeCounts = [...syndromeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([pattern, count]) => ({ pattern, count, stable: pattern.split('').every((b) => b === '0') }));

  return {
    shots,
    outcomeCounts,
    syndromeCounts,
    avgFidelityQEC: fidelitySum / shots,
    avgFidelityBare: bareSum / shots,
    logicalErrorRate: 1 - successCount / shots,
    logicalSuccessRate: successCount / shots,
    successRule,
    detectionRate: detectedCount / shots,
    correctionRate: correctedCount / shots,
    runtimeMs,
    msPerShot: runtimeMs / shots,
    settings: {
      codeId: code.id,
      codeName: code.name,
      noise,
      p: params.p,
      pMeas,
      seed,
      engine: 'Client-side state-vector simulator (seeded mulberry32 RNG)',
    },
  };
}

// ---------------------------------------------------------------------------
// Single-shot trace for UI visualization (state-vector codes)
// ---------------------------------------------------------------------------

export interface ShotTrace {
  codeId: string;
  codeName: string;
  noiseId: NoiseModelId;
  noiseName: string;
  p: number;
  theta: number;
  phi: number;
  stateLabel: string;
  inputAmps: { label: string; re: number; im: number; prob: number }[];
  encodedAmps: { label: string; re: number; im: number; prob: number }[];
  afterNoiseAmps: { label: string; re: number; im: number; prob: number }[];
  noiseEvents: { qubit: number; qubit2?: number; kind: string; detail: string }[];
  syndrome: { label: string; bit: number }[];
  correction: { x: number[]; z: number[] };
  decodedBloch: { x: number; y: number; z: number };
  beforeBloch: { x: number; y: number; z: number };
  fidelity: number;
  fidelityBefore: number;
  recovered: boolean;
  measuredOutcome: 0 | 1;
  elapsedMs: number;
  detectionNote: string;
}

function stateLabel(theta: number, phi: number): string {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  if (Math.abs(s) < 1e-9) return '|0⟩';
  if (Math.abs(c) < 1e-9) return phi === 0 ? '|1⟩' : `e^(i${phi.toFixed(2)})|1⟩`;
  if (Math.abs(c - s) < 1e-9 && Math.abs(phi) < 1e-9) return '|+⟩';
  if (Math.abs(c + s) < 1e-9 && Math.abs(phi) < 1e-9) return '|−⟩';
  return `cos(${(theta / 2).toFixed(2)})|0⟩ + e^(i${phi.toFixed(2)})·sin(${(theta / 2).toFixed(2)})|1⟩`;
}

function eventDetail(e: { kind: string; qubit: number; qubit2?: number; prob: number }, thetaDeg: number): string {
  switch (e.kind) {
    case 'X': return `Pauli-X (bit flip) hit qubit ${e.qubit}`;
    case 'Y': return `Pauli-Y hit qubit ${e.qubit}`;
    case 'Z': return `Pauli-Z (phase flip) hit qubit ${e.qubit}`;
    default: return `Error on qubit ${e.qubit}`;
  }
}

export function runTrace(
  code: SVCodeDef,
  noise: NoiseModelId,
  params: NoiseParams,
  theta: number,
  phi: number,
  seed: number,
  forcedErrors?: { qubit: number; x?: boolean; z?: boolean }[] | null,
  pMeas = 0
): ShotTrace {
  const rng = makeRng(seed);
  const t0 = Date.now();
  const sv = new StateVector(code.n);
  sv.prepareQubit0(theta, phi);
  const inputAmps = sv.topAmplitudes(1e-4, 2);

  // ---- encoding
  for (const op of code.encoding) sv.applyGateOp(op.gate, op.qubits, op.param);
  const encodedAmps = sv.topAmplitudes(0.01, 8);

  // ---- noise
  let events: { kind: string; qubit: number; qubit2?: number; prob: number }[] = [];
  if (forcedErrors && forcedErrors.length > 0) {
    for (const fe of forcedErrors) {
      if (fe.x) { sv.applyGate1(fe.qubit, GATES.X); events.push({ kind: 'X', qubit: fe.qubit, prob: 1 }); }
      if (fe.z) { sv.applyGate1(fe.qubit, GATES.Z); events.push({ kind: 'Z', qubit: fe.qubit, prob: 1 }); }
    }
  } else {
    events = applyNoiseLayer(sv, noise, params, rng);
  }
  const afterNoiseAmps = sv.topAmplitudes(0.01, 8);

  // ---- syndrome extraction
  const syndrome: { label: string; bit: number }[] = [];
  for (const st of code.stabilizers) {
    const { outcome } = sv.measurePauli(st.paulis, rng, pMeas > 0 && rng() < pMeas);
    syndrome.push({ label: st.label, bit: outcome === -1 ? 1 : 0 });
  }
  const syndromeBits = syndrome.map((s) => s.bit);
  let correction = { x: [] as number[], z: [] as number[] };
  if (syndromeBits.some((b) => b === 1)) {
    correction = lookupCorrection(code, syndromeBits);
    for (const q of correction.x) sv.applyGate1(q, GATES.X);
    for (const q of correction.z) sv.applyGate1(q, GATES.Z);
  }

  // ---- decode + fidelity
  for (const op of code.decoding) sv.applyGateOp(op.gate, op.qubits, op.param);
  const rho: number[] = sv.partialTraceQ0();
  const fidelity = fidelityFromRho(rho, theta, phi);

  // ---- bare-qubit baseline
  const bare = new StateVector(1);
  bare.prepareQubit0(theta, phi);
  if (forcedErrors && forcedErrors.length > 0) {
    for (const fe of forcedErrors) {
      if (fe.x && fe.z) bare.applyGateOp('Y', [0]);
      else if (fe.x) bare.applyGateOp('X', [0]);
      else if (fe.z) bare.applyGateOp('Z', [0]);
    }
  } else {
    applyNoiseLayer(bare, noise, params, rng);
  }
  const bareRho = bare.partialTraceQ0();
  const fidelityBefore = fidelityFromRho(bareRho, theta, phi);

  // ---- logical measurement outcome (Z-basis readout of the decoded qubit)
  const pOne = rho[6];
  const measuredOutcome: 0 | 1 = rng() < pOne ? 1 : 0;

  const recovered = fidelity > 0.999;
  const info = getNoiseModel(noise);

  const anyDefect = syndromeBits.some((b) => b === 1);
  const detectionNote = anyDefect
    ? 'Syndrome flags detected — decoder identified the error location and a correction was applied.'
    : forcedErrors && forcedErrors.length > 0
      ? 'Injected error is invisible to this code (its syndrome is trivial), so no correction was made.'
      : 'No detectable error occurred this shot.';

  return {
    codeId: code.id,
    codeName: code.name,
    noiseId: noise,
    noiseName: info.name,
    p: params.p,
    theta,
    phi,
    stateLabel: stateLabel(theta, phi),
    inputAmps,
    encodedAmps,
    afterNoiseAmps,
    noiseEvents: events.map((e) => ({ ...e, detail: eventDetail(e, 0) })),
    syndrome,
    correction,
    decodedBloch: blochFromRho(rho),
    beforeBloch: blochFromRho(bareRho),
    fidelity,
    fidelityBefore,
    recovered,
    measuredOutcome,
    elapsedMs: Date.now() - t0,
    detectionNote,
  };
}
