/**
 * Quantum Error Correction codes (state-vector engine).
 *
 * SCOPE — the QEC codes implemented in all_with_noise_prob.py:
 *   1. bit_flip_qec   -> 3-Qubit Bit-Flip Code
 *   2. phase_flip_qec -> 3-Qubit Phase-Flip Code
 * plus the Shor 9-Qubit code — the user-requested upgrade that corrects any
 * single arbitrary error (X, Y or Z), which is exactly what depolarizing
 * noise demands.
 *
 * Each code defines:
 *  - encoding / decoding circuits (real unitary circuits, visualized in the UI)
 *  - stabilizer generators (syndrome extracted via projective Pauli measurements)
 *  - an auto-generated syndrome -> correction lookup table (single-error optimal,
 *    nearest-match fallback for uncorrectable multi-error syndromes)
 */

import { Pauli, RNG, StateVector, GATES, fidelityFromRho, blochFromRho } from './engine';
import { NoiseModelId, NoiseParams, applyNoiseLayer, NoiseEvent } from './noise';

export interface GateOp {
  gate: 'H' | 'X' | 'Y' | 'Z' | 'S' | 'CNOT' | 'CZ' | 'CH' | 'RX' | 'RY' | 'RZ';
  qubits: number[];
  param?: number;
  comment?: string;
}

export interface StabilizerDef {
  paulis: Pauli[]; // length n
  label: string;
  type: 'X' | 'Z'; // dominant type (used for grouping / display)
}

export interface Correction {
  x: number[]; // qubits to apply X
  z: number[]; // qubits to apply Z
}

export interface SVCodeDef {
  id: string;
  name: string;
  short: string;
  n: number;
  k: number;
  d: number;
  family: string;
  corrects: string;
  description: string;
  logicalX: Pauli[];
  logicalZ: Pauli[];
  encoding: GateOp[];
  decoding: GateOp[]; // inverse circuit
  stabilizers: StabilizerDef[];
  correctionTable: Map<string, Correction>; // key = syndrome bit string
}

// ---------------------------------------------------------------------------
// Syndrome table construction
// ---------------------------------------------------------------------------

function syndromeKey(bits: number[]): string {
  return bits.join('');
}

/** anticommutes between single-qubit Pauli a and stabilizer generator s */
function pauliAnticommute(a: Pauli, s: Pauli): boolean {
  if (a === 'I' || s === 'I') return false;
  return a !== s; // X-Z, X-Y, Y-Z anticommute; same types commute
}

export function syndromeOfError(code: SVCodeDef, qubit: number, err: Pauli): number[] {
  return code.stabilizers.map((st) => (pauliAnticommute(err, st.paulis[qubit]) ? 1 : 0));
}

/**
 * Build the syndrome -> correction map by enumerating all single-qubit errors.
 * First occurrence wins (handles degenerate codes like Shor correctly:
 * any within-block Z correction is equivalent up to stabilizers).
 */
export function buildCorrectionTable(code: Omit<SVCodeDef, 'correctionTable'>): Map<string, Correction> {
  const table = new Map<string, Correction>();
  // Order matters: pure X and Z errors take priority over Y in the lookup table.
  // Codes that cannot correct Y (e.g. repetition codes) share syndromes between
  // Y and the correctable pure error — the pure correction is the right choice.
  // Codes that DO correct Y (Shor/Steane/5-qubit) have distinct Y syndromes, so
  // this ordering is harmless for them.
  for (let q = 0; q < code.n; q++) {
    for (const err of ['X', 'Z', 'Y'] as Pauli[]) {
      const bits = syndromeOfError(code as SVCodeDef, q, err);
      // Errors with an all-zero syndrome are invisible to this code (degenerate with
      // identity, e.g. Z errors on a bit-flip code) — they must NOT be corrected.
      if (bits.every((b) => b === 0)) continue;
      const key = syndromeKey(bits);
      if (!table.has(key)) {
        table.set(key, {
          x: err === 'X' || err === 'Y' ? [q] : [],
          z: err === 'Z' || err === 'Y' ? [q] : [],
        });
      }
    }
  }
  return table;
}

/** Lookup correction with nearest-syndrome fallback (minimum Hamming distance). */
export function lookupCorrection(code: SVCodeDef, syndrome: number[]): Correction {
  // trivial syndrome -> no correction (prevents mis-correcting invisible errors)
  if (syndrome.every((b) => b === 0)) return { x: [], z: [] };
  const key = syndromeKey(syndrome);
  const direct = code.correctionTable.get(key);
  if (direct) return direct;
  // nearest match
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const k of code.correctionTable.keys()) {
    let dist = 0;
    for (let i = 0; i < syndrome.length; i++) {
      if (k[i] !== String(syndrome[i])) dist++;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = k;
    }
  }
  if (bestKey && bestDist <= 2) return code.correctionTable.get(bestKey)!;
  return { x: [], z: [] }; // give up (uncorrectable)
}

// ---------------------------------------------------------------------------
// Code definitions
// ---------------------------------------------------------------------------

function pauliStr(spec: string): Pauli[] {
  return spec.replace(/ /g, '').split('') as Pauli[];
}

function reverseOps(ops: GateOp[]): GateOp[] {
  return [...ops].reverse();
}

// --- 3-qubit bit-flip code --------------------------------------------------

const enc3b: GateOp[] = [
  { gate: 'CNOT', qubits: [0, 1] },
  { gate: 'CNOT', qubits: [0, 2] },
];

const code3BitflipBase = {
  id: 'code-3bitflip',
  name: '3-Qubit Bit-Flip Code',
  short: '3-Qubit Bit-Flip',
  n: 3,
  k: 1,
  d: 3,
  family: 'Repetition (CSS-like)',
  corrects: '1 bit-flip (X) error',
  description:
    'Encodes |psi> into alpha|000> + beta|111>. Majority voting via two Z-parity stabilizers ' +
    'localizes a single bit-flip. The workhorse introductory QEC code and the exact scheme ' +
    'walked through in our Phase-1 architecture example.',
  logicalX: pauliStr('XXX'),
  logicalZ: pauliStr('ZZZ'),
  encoding: enc3b,
  decoding: reverseOps(enc3b),
  stabilizers: [
    { paulis: pauliStr('ZZI'), label: 'Z0 Z1', type: 'Z' as const },
    { paulis: pauliStr('IZZ'), label: 'Z1 Z2', type: 'Z' as const },
  ],
};

export const CODE_3BITFLIP: SVCodeDef = {
  ...code3BitflipBase,
  correctionTable: buildCorrectionTable(code3BitflipBase as SVCodeDef),
};

// --- 3-qubit phase-flip code -------------------------------------------------

const enc3p: GateOp[] = [
  { gate: 'H', qubits: [0] },
  { gate: 'CNOT', qubits: [0, 1] },
  { gate: 'CNOT', qubits: [0, 2] },
  { gate: 'H', qubits: [0] },
  { gate: 'H', qubits: [1] },
  { gate: 'H', qubits: [2] },
];

const code3PhaseflipBase = {
  id: 'code-3phaseflip',
  name: '3-Qubit Phase-Flip Code',
  short: '3-Qubit Phase-Flip',
  n: 3,
  k: 1,
  d: 3,
  family: 'H-conjugated repetition',
  corrects: '1 phase-flip (Z) error',
  description:
    'The Hadamard-conjugate of the bit-flip code: encodes into the GHZ-like state ' +
    '(|+++> + |--->)/sqrt(2) and corrects a single phase flip using X-parity checks. ' +
    'Demonstrates that phase errors require a different detection strategy.',
  logicalX: pauliStr('XXX'),
  logicalZ: pauliStr('ZZZ'),
  encoding: enc3p,
  decoding: reverseOps(enc3p),
  stabilizers: [
    { paulis: pauliStr('XXI'), label: 'X0 X1', type: 'X' as const },
    { paulis: pauliStr('IXX'), label: 'X1 X2', type: 'X' as const },
  ],
};

export const CODE_3PHASEFLIP: SVCodeDef = {
  ...code3PhaseflipBase,
  correctionTable: buildCorrectionTable(code3PhaseflipBase as SVCodeDef),
};

// --- Shor 9-qubit code -------------------------------------------------------
// Concatenation of the 3-qubit phase-flip code (outer, block leaders 0·3·6)
// with three 3-qubit bit-flip codes (inner blocks 0-1-2 / 3-4-5 / 6-7-8).
// Corrects ANY single arbitrary (X, Y or Z) error — including every
// depolarizing outcome — which is exactly why it is the flagship code here.

const encShor: GateOp[] = [
  // outer phase-flip layer: α|000⟩ + β|111⟩ across the block leaders 0,3,6
  { gate: 'H', qubits: [0] },
  { gate: 'CNOT', qubits: [0, 3] },
  { gate: 'CNOT', qubits: [0, 6] },
  { gate: 'H', qubits: [0] },
  { gate: 'H', qubits: [3] },
  { gate: 'H', qubits: [6] },
  // inner bit-flip layers inside each block
  { gate: 'CNOT', qubits: [0, 1] },
  { gate: 'CNOT', qubits: [0, 2] },
  { gate: 'CNOT', qubits: [3, 4] },
  { gate: 'CNOT', qubits: [3, 5] },
  { gate: 'CNOT', qubits: [6, 7] },
  { gate: 'CNOT', qubits: [6, 8] },
];

const codeShor9Base = {
  id: 'code-shor9',
  name: 'Shor 9-Qubit Code',
  short: 'Shor Code',
  n: 9,
  k: 1,
  d: 3,
  family: 'Concatenated (phase-flip ⊗ bit-flip)',
  corrects: '1 arbitrary (X, Y or Z) error',
  description:
    'The first quantum error-correcting code ever discovered (Shor, 1995). Three bit-flip blocks sit on top of a phase-flip backbone, so a single error of ANY kind — bit-flip, phase-flip, or both (a Y from depolarizing noise) — is detected and reversed. It is the right upgrade when depolarizing noise breaks the smaller 3-qubit codes.',
  logicalX: pauliStr('XXXXXXXXX'),
  logicalZ: pauliStr('ZZZZZZZZZ'),
  encoding: encShor,
  decoding: reverseOps(encShor),
  stabilizers: [
    { paulis: pauliStr('ZZIIIIIII'), label: 'Z0 Z1', type: 'Z' as const },
    { paulis: pauliStr('IZZIIIIII'), label: 'Z1 Z2', type: 'Z' as const },
    { paulis: pauliStr('IIIZZIIII'), label: 'Z3 Z4', type: 'Z' as const },
    { paulis: pauliStr('IIIIZZIII'), label: 'Z4 Z5', type: 'Z' as const },
    { paulis: pauliStr('IIIIIIZZI'), label: 'Z6 Z7', type: 'Z' as const },
    { paulis: pauliStr('IIIIIIIZZ'), label: 'Z7 Z8', type: 'Z' as const },
    { paulis: pauliStr('XXXXXXIII'), label: 'X0–X5', type: 'X' as const },
    { paulis: pauliStr('XXXIIIXXX'), label: 'X0–X2, X6–X8', type: 'X' as const },
  ],
};

export const CODE_SHOR9: SVCodeDef = {
  ...codeShor9Base,
  correctionTable: buildCorrectionTable(codeShor9Base as SVCodeDef),
};

export const SV_CODES: SVCodeDef[] = [
  CODE_3BITFLIP,
  CODE_3PHASEFLIP,
  CODE_SHOR9,
];

export function getSVCode(id: string): SVCodeDef {
  const c = SV_CODES.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown code ${id}`);
  return c;
}

// ---------------------------------------------------------------------------
// Full single-shot pipeline (state-vector codes)
// ---------------------------------------------------------------------------

export interface ForcedError {
  qubit: number;
  x?: boolean;
  z?: boolean;
}

export interface ShotOptions {
  theta: number;
  phi: number;
  noise: NoiseModelId;
  params: NoiseParams;
  forcedErrors?: ForcedError[] | null; // manual error injection (skip random sampling)
  measureSyndrome?: boolean;           // if false, skip syndrome+correction (diagnostics)
  pMeas?: number;                      // syndrome readout error
}

export interface ShotResult {
  fidelity: number;
  rho: number[];
  bloch: { x: number; y: number; z: number };
  syndrome: number[];          // 1 = defect
  syndromeLabels: string[];
  correction: Correction;
  noiseEvents: NoiseEvent[];
  detected: boolean;
}

/** Run one noisy shot: encode -> noise -> syndrome -> correct -> decode -> readout */
export function runShot(code: SVCodeDef, opts: ShotOptions, rng: RNG): ShotResult {
  const sv = new StateVector(code.n);
  sv.prepareQubit0(opts.theta, opts.phi);

  // encode
  for (const op of code.encoding) sv.applyGateOp(op.gate, op.qubits, op.param);

  // noise
  let noiseEvents: NoiseEvent[] = [];
  if (opts.forcedErrors && opts.forcedErrors.length > 0) {
    for (const fe of opts.forcedErrors) {
      if (fe.x) {
        sv.applyGate1(fe.qubit, GATES.X);
        noiseEvents.push({ qubit: fe.qubit, kind: 'X', prob: 1 });
      }
      if (fe.z) {
        sv.applyGate1(fe.qubit, GATES.Z);
        noiseEvents.push({ qubit: fe.qubit, kind: 'Z', prob: 1 });
      }
    }
  } else {
    noiseEvents = applyNoiseLayer(sv, opts.noise, opts.params, rng);
  }

  // syndrome extraction + correction
  const syndrome: number[] = [];
  const labels: string[] = [];
  let correction: Correction = { x: [], z: [] };
  if (opts.measureSyndrome !== false) {
    for (const st of code.stabilizers) {
      const { outcome } = sv.measurePauli(st.paulis, rng, (opts.pMeas ?? 0) > 0 && rng() < (opts.pMeas ?? 0));
      syndrome.push(outcome === -1 ? 1 : 0);
      labels.push(st.label);
    }
    correction = lookupCorrection(code, syndrome);
    for (const q of correction.x) sv.applyGate1(q, GATES.X);
    for (const q of correction.z) sv.applyGate1(q, GATES.Z);
  }

  // decode
  for (const op of code.decoding) sv.applyGateOp(op.gate, op.qubits, op.param);
  const rho: number[] = sv.partialTraceQ0();

  return {
    fidelity: fidelityFromRho(rho, opts.theta, opts.phi),
    rho,
    bloch: blochFromRho(rho),
    syndrome,
    syndromeLabels: labels,
    correction,
    noiseEvents,
    detected: syndrome.some((s) => s === 1),
  };
}

// re-exports for downstream modules
export { fidelityFromRho, blochFromRho };
