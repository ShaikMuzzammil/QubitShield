/**
 * Full-pipeline circuit builder — the "large, complete circuit" view.
 *
 * Mirrors the circuit structure of all_with_noise_prob.py exactly:
 *   input prep → encoding → noise slot (ID gate at the error qubit) →
 *   syndrome extraction (CNOTs into ancilla qubits + measurement) →
 *   conditional correction (if_test on the syndrome register) →
 *   decode → final measurement.
 *
 * Unlike the Python file, every code gets a fully general construction:
 *   Z-type check  → CNOTs from each data qubit in the support into the ancilla,
 *                   then measure the ancilla  (parity of Z errors).
 *   X-type check  → H on the ancilla, CNOTs from the ancilla into every data
 *                   qubit in the support, H on the ancilla, then measure
 *                   (parity of X errors).
 * The conditional-correction stage shows one dashed "if syndrome = ..." box
 * per single-error entry of the code's decoder lookup table — X boxes where
 * the decoder would apply X, Z boxes where it would apply Z. In a live shot
 * the actually-triggered box is highlighted.
 */

import { SVCodeDef, GateOp } from './codes';
import { NoiseEvent } from './noise';

// ---------------------------------------------------------------------------
// Circuit model
// ---------------------------------------------------------------------------

export type CircuitOp =
  | { kind: 'prep'; qubit: number; label: string }                     // input state preparation
  | { kind: 'gate'; gate: string; qubits: number[]; label?: string }   // unitary gate (H, X, CNOT, ...)
  | { kind: 'id'; qubit: number; label?: string }                      // noise slot (ID gate, like qc.id(q))
  | { kind: 'measure'; qubit: number; cbit: number; label?: string }   // Z-basis measurement into classical bit
  | { kind: 'cond'; qubit: number; gate: 'X' | 'Z'; syndrome: string; cbitFrom: number; cbitTo: number } // conditional correction
  | { kind: 'measureFinal'; qubit: number; cbit: number; label?: string };

export interface CircuitStage {
  key: 'input' | 'encode' | 'noise' | 'syndrome' | 'correct' | 'decode' | 'measure';
  label: string;
  hint: string;
  /** ultra-short hint drawn in narrow stage bands (full hint becomes the hover tooltip) */
  short?: string;
  ops: CircuitOp[];
}

export interface FullCircuit {
  codeId: string;
  codeName: string;
  nData: number;
  nAnc: number;
  nClassical: number; // syndrome bits + 1 final outcome bit
  stages: CircuitStage[];
}

/** Information about one executed shot, used to annotate the static circuit. */
export interface ShotAnnotation {
  noiseEvents: { qubit: number; kind: string }[];
  correction: { x: number[]; z: number[] };
  syndrome: number[];
  measuredOutcome?: 0 | 1;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildFullCircuit(code: SVCodeDef, stateLabel: string): FullCircuit {
  const nData = code.n;
  const nAnc = code.stabilizers.length;
  const nClassical = nAnc + 1;
  const anc = (i: number) => nData + i; // ancilla row index
  const cbit = (i: number) => i;

  // ---- INPUT ---------------------------------------------------------------
  const isBasis = stateLabel === '|0⟩' || stateLabel === '|1⟩';
  const inputOps: CircuitOp[] = isBasis
    ? [{ kind: 'prep', qubit: 0, label: stateLabel === '|1⟩' ? 'X · input |1⟩' : 'input |0⟩' }]
    : [{ kind: 'prep', qubit: 0, label: `prepare ${stateLabel}` }];

  // ---- ENCODE ---------------------------------------------------------------
  const encodeOps: CircuitOp[] = code.encoding.map(
    (op: GateOp) => ({ kind: 'gate', gate: op.gate, qubits: [...op.qubits] } as CircuitOp)
  );

  // ---- NOISE ----------------------------------------------------------------
  // One ID slot per data qubit (the engine applies the channel to every qubit);
  // the live shot highlights the qubits that were actually hit.
  const noiseOps: CircuitOp[] = Array.from({ length: nData }, (_, q) => ({
    kind: 'id',
    qubit: q,
    label: 'ID',
  } as CircuitOp));

  // ---- SYNDROME -------------------------------------------------------------
  const syndromeOps: CircuitOp[] = [];
  code.stabilizers.forEach((st, si) => {
    const support: number[] = [];
    st.paulis.forEach((p, qi) => {
      if (p !== 'I') support.push(qi);
    });
    if (st.type === 'Z') {
      // Z-parity: data qubits control, ancilla target (exactly like the Python file)
      for (const q of support) syndromeOps.push({ kind: 'gate', gate: 'CNOT', qubits: [q, anc(si)] });
      syndromeOps.push({ kind: 'measure', qubit: anc(si), cbit: cbit(si), label: `s${si}` });
    } else {
      // X-parity: H sandwich on the ancilla, ancilla drives the data qubits
      syndromeOps.push({ kind: 'gate', gate: 'H', qubits: [anc(si)] });
      for (const q of support) syndromeOps.push({ kind: 'gate', gate: 'CNOT', qubits: [anc(si), q] });
      syndromeOps.push({ kind: 'gate', gate: 'H', qubits: [anc(si)] });
      syndromeOps.push({ kind: 'measure', qubit: anc(si), cbit: cbit(si), label: `s${si}` });
    }
  });

  // ---- CORRECT --------------------------------------------------------------
  // One conditional box per single-error decoder entry (matches the Python
  // if_test blocks; for the Shor code it covers X, Y and Z outcomes).
  const correctOps: CircuitOp[] = [];
  const seen = new Set<string>();
  for (const [key, corr] of code.correctionTable.entries()) {
    for (const q of corr.x) {
      const id = `X${q}:${key}`;
      if (!seen.has(id)) {
        seen.add(id);
        correctOps.push({ kind: 'cond', qubit: q, gate: 'X', syndrome: key, cbitFrom: 0, cbitTo: nAnc - 1 });
      }
    }
    for (const q of corr.z) {
      const id = `Z${q}:${key}`;
      if (!seen.has(id)) {
        seen.add(id);
        correctOps.push({ kind: 'cond', qubit: q, gate: 'Z', syndrome: key, cbitFrom: 0, cbitTo: nAnc - 1 });
      }
    }
  }

  // ---- DECODE ---------------------------------------------------------------
  const decodeOps: CircuitOp[] = code.decoding.map(
    (op: GateOp) => ({ kind: 'gate', gate: op.gate, qubits: [...op.qubits] } as CircuitOp)
  );

  // ---- MEASURE --------------------------------------------------------------
  const measureOps: CircuitOp[] = [
    { kind: 'measureFinal', qubit: 0, cbit: nAnc, label: 'logical' },
  ];

  return {
    codeId: code.id,
    codeName: code.name,
    nData,
    nAnc,
    nClassical,
    stages: [
      { key: 'input', label: 'Input', short: 'prep', hint: 'state preparation (ket of the logical qubit)', ops: inputOps },
      { key: 'encode', label: 'Encode', short: 'encoding circuit', hint: 'unitary encoding circuit', ops: encodeOps },
      { key: 'noise', label: 'Noise', short: 'ID slots', hint: 'error channel — one ID slot per data qubit', ops: noiseOps },
      { key: 'syndrome', label: 'Syndrome', short: 'stabilizer checks + measurement', hint: 'stabilizer checks + measurement', ops: syndromeOps },
      { key: 'correct', label: 'Correct', short: 'recovery', hint: 'conditional recovery from the decoder table', ops: correctOps },
      { key: 'decode', label: 'Decode', short: 'inverse circuit', hint: 'inverse encoding circuit', ops: decodeOps },
      { key: 'measure', label: 'Measure', short: 'readout', hint: 'logical readout', ops: measureOps },
    ],
  };
}

// ---------------------------------------------------------------------------
// Layout — time-ordered columns (one op per column within a stage, greedy
// packing of qubit-disjoint ops), stage bands for the labels.
// ---------------------------------------------------------------------------

export interface PlacedOp {
  op: CircuitOp;
  stageIndex: number;
  col: number; // absolute column
}

export interface CircuitLayout {
  rows: number;            // total quantum rows (data + ancilla)
  totalColumns: number;
  placed: PlacedOp[];
  stageBands: { stageIndex: number; colFrom: number; colTo: number }[];
  firstMeasureCol: number; // where classical wires begin
}

export function layoutCircuit(circuit: FullCircuit): CircuitLayout {
  const rows = circuit.nData + circuit.nAnc;
  const rowFreeAt = new Array<number>(rows).fill(0); // next free column per quantum row
  const cbitFreeAt = new Array<number>(circuit.nClassical).fill(0);
  const placed: PlacedOp[] = [];
  const stageBands: CircuitLayout['stageBands'] = [];
  let col = 0;
  let firstMeasureCol = -1;

  circuit.stages.forEach((stage, si) => {
    const stageStart = col;
    for (const op of stage.ops) {
      const qs = opQubits(op);
      const cb = opCbits(op);
      // earliest column where every involved qubit AND classical bit is free.
      // Search starts at the STAGE START column, so qubit-disjoint ops pack
      // into shared columns (backfill) — this keeps the drawn circuit compact
      // (e.g. the Shor syndrome stage collapses from ~30 columns to ~14)
      // while ops that DO share a qubit keep their relative order.
      let c = stageStart;
      // no global backtracking needed: columns only move forward within stage
      let found = false;
      while (!found) {
        found = true;
        for (const q of qs) if (rowFreeAt[q] > c) { c = rowFreeAt[q]; found = false; }
        for (const b of cb) if (cbitFreeAt[b] > c) { c = cbitFreeAt[b]; found = false; }
      }
      // reserve
      const span = opKindSpan(op);
      for (const q of qs) rowFreeAt[q] = c + span;
      for (const b of cb) cbitFreeAt[b] = c + span;
      // measurement writes start the classical wires
      if ((op.kind === 'measure' || op.kind === 'measureFinal') && (firstMeasureCol < 0 || c < firstMeasureCol)) {
        firstMeasureCol = c;
      }
      placed.push({ op, stageIndex: si, col: c });
      col = Math.max(col, c + 1);
    }
    stageBands.push({ stageIndex: si, colFrom: stageStart, colTo: Math.max(col - 1, stageStart) });
    // one spacer column between stages (visually separates the phases)
    col += 1;
  });

  return {
    rows,
    totalColumns: col,
    placed,
    stageBands,
    firstMeasureCol: firstMeasureCol < 0 ? col : firstMeasureCol,
  };
}

function opQubits(op: CircuitOp): number[] {
  switch (op.kind) {
    case 'prep': return [op.qubit];
    case 'gate': return op.qubits;
    case 'id': return [op.qubit];
    case 'measure': return [op.qubit];
    case 'cond': return [op.qubit];
    case 'measureFinal': return [op.qubit];
  }
}

function opCbits(op: CircuitOp): number[] {
  switch (op.kind) {
    case 'measure': return [op.cbit];
    case 'measureFinal': return [op.cbit];
    default: return [];
  }
}

/** column width reservation: two-qubit gates + conditional boxes get one column (large cells) */
function opKindSpan(_op: CircuitOp): number {
  return 1;
}

// ---------------------------------------------------------------------------
// Human-readable step log — "how it came" for exports
// ---------------------------------------------------------------------------

export function describeSyndrome(code: SVCodeDef, syndrome: number[]): string {
  if (!syndrome.some((b) => b === 1)) return 'All stabilizers +1 (trivial syndrome — no error detected).';
  const flagged = syndrome
    .map((b, i) => ({ b, st: code.stabilizers[i] }))
    .filter((x) => x.b === 1)
    .map((x) => `${x.st.label} = −1 (defect)`);
  return `Defects: ${flagged.join('; ')}.`;
}

export function describeCorrection(corr: { x: number[]; z: number[] }): string {
  if (!corr.x.length && !corr.z.length) return 'No recovery operation required.';
  const parts: string[] = [];
  if (corr.x.length) parts.push(`Pauli-X on q${corr.x.join(', q')} (undoes a bit flip)`);
  if (corr.z.length) parts.push(`Pauli-Z on q${corr.z.join(', q')} (undoes a phase flip)`);
  return `Decoder decision → recovery: ${parts.join(' + ')}.`;
}

export function describeNoise(events: { qubit: number; kind: string }[], modelName: string, p: number): string {
  if (!events.length) return `${modelName} at p = ${p} — no error was sampled on this shot (the ID slots passed cleanly).`;
  return `${modelName} at p = ${p} sampled: ${events.map((e) => `${e.kind} on q${e.qubit}`).join(', ')}.`;
}
