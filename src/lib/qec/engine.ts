/**
 * Quantum state-vector engine for QEC simulation.
 * Pure TypeScript, no DOM dependencies — runs in browser and Node (bun) tests.
 *
 * Convention: qubit q corresponds to bit position q (little-endian).
 * State vector stored as Float64Array with interleaved re/im: [re0, im0, re1, im1, ...]
 */

export type RNG = () => number;

/** Deterministic PRNG (mulberry32) */
export function makeRng(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Pauli = 'I' | 'X' | 'Y' | 'Z';

/** 2x2 complex matrix, flat [re00, im00, re01, im01, re10, im10, re11, im11] */
export type Mat2 = Float64Array; // length 8

export function mat2(re: number[], im: number[]): Mat2 {
  const m = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    m[2 * i] = re[i];
    m[2 * i + 1] = im[i];
  }
  return m;
}

export const GATES: Record<string, Mat2> = {
  I: mat2([1, 0, 0, 1], [0, 0, 0, 0]),
  X: mat2([0, 1, 1, 0], [0, 0, 0, 0]),
  Z: mat2([1, 0, 0, -1], [0, 0, 0, 0]),
  H: mat2([Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2], [0, 0, 0, 0]),
  S: mat2([1, 0, 0, 0], [0, 0, 0, 1]),
  // Pauli-Y = [[0, -i], [i, 0]]
  Y: mat2([0, 0, 0, 0], [0, -1, 1, 0]),
};

export function rx(theta: number): Mat2 {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return mat2([c, 0, 0, c], [0, -s, -s, 0]);
}

export function ry(theta: number): Mat2 {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return mat2([c, -s, s, c], [0, 0, 0, 0]);
}

export function rz(theta: number): Mat2 {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return mat2([c, 0, 0, c], [-s, 0, 0, s]);
}

export class StateVector {
  n: number;
  size: number;
  data: Float64Array; // interleaved re/im

  constructor(n: number) {
    this.n = n;
    this.size = 1 << n;
    this.data = new Float64Array(2 * this.size);
    this.data[0] = 1; // |0...0>
  }

  clone(): StateVector {
    const sv = new StateVector(this.n);
    sv.data.set(this.data);
    return sv;
  }

  /** Prepare single logical qubit state cos(t/2)|0> + e^{i phi} sin(t/2)|1> on qubit 0 */
  prepareQubit0(theta: number, phi: number) {
    this.data.fill(0);
    const c = Math.cos(theta / 2);
    const s = Math.sin(theta / 2);
    this.data[0] = c;
    this.data[2] = s * Math.cos(phi);
    this.data[3] = s * Math.sin(phi);
  }

  norm(): number {
    let s = 0;
    for (let i = 0; i < this.size; i++) s += this.data[2 * i] ** 2 + this.data[2 * i + 1] ** 2;
    return Math.sqrt(s);
  }

  normalize() {
    const nrm = this.norm();
    if (nrm > 1e-14) {
      for (let i = 0; i < this.data.length; i++) this.data[i] /= nrm;
    }
  }

  applyGate1(q: number, m: Mat2) {
    const d = this.data;
    const bit = 1 << q;
    for (let i = 0; i < this.size; i++) {
      if (i & bit) continue;
      const j = i | bit;
      const a0r = d[2 * i], a0i = d[2 * i + 1];
      const a1r = d[2 * j], a1i = d[2 * j + 1];
      // out0 = m00*v0 + m01*v1
      d[2 * i] = m[0] * a0r - m[1] * a0i + m[2] * a1r - m[3] * a1i;
      d[2 * i + 1] = m[0] * a0i + m[1] * a0r + m[2] * a1i + m[3] * a1r;
      // out1 = m10*v0 + m11*v1
      d[2 * j] = m[4] * a0r - m[5] * a0i + m[6] * a1r - m[7] * a1i;
      d[2 * j + 1] = m[4] * a0i + m[5] * a0r + m[6] * a1i + m[7] * a1r;
    }
  }

  applyCNOT(control: number, target: number) {
    const bitC = 1 << control;
    const bitT = 1 << target;
    const d = this.data;
    for (let i = 0; i < this.size; i++) {
      if ((i & bitC) && !(i & bitT)) {
        const j = i | bitT;
        const tr = d[2 * i], ti = d[2 * i + 1];
        d[2 * i] = d[2 * j]; d[2 * i + 1] = d[2 * j + 1];
        d[2 * j] = tr; d[2 * j + 1] = ti;
      }
    }
  }

  applyCZ(control: number, target: number) {
    const bitC = 1 << control;
    const bitT = 1 << target;
    const d = this.data;
    for (let i = 0; i < this.size; i++) {
      if (i & bitC && i & bitT) {
        d[2 * i] = -d[2 * i];
        d[2 * i + 1] = -d[2 * i + 1];
      }
    }
  }

  /** Controlled-H (needed for CSS encoders) */
  applyCH(control: number, target: number) {
    const bitC = 1 << control;
    const bitT = 1 << target;
    const h = GATES.H;
    const d = this.data;
    for (let i = 0; i < this.size; i++) {
      if (i & bitC && !(i & bitT)) {
        const j = i | bitT;
        const a0r = d[2 * i], a0i = d[2 * i + 1];
        const a1r = d[2 * j], a1i = d[2 * j + 1];
        d[2 * i] = h[0] * a0r - h[1] * a0i + h[2] * a1r - h[3] * a1i;
        d[2 * i + 1] = h[0] * a0i + h[1] * a0r + h[2] * a1i + h[3] * a1r;
        d[2 * j] = h[4] * a0r - h[5] * a0i + h[6] * a1r - h[7] * a1i;
        d[2 * j + 1] = h[4] * a0i + h[5] * a0r + h[6] * a1i + h[7] * a1r;
      }
    }
  }

  applyGateOp(gate: string, qubits: number[], param?: number) {
    switch (gate) {
      case 'H': this.applyGate1(qubits[0], GATES.H); break;
      case 'X': this.applyGate1(qubits[0], GATES.X); break;
      case 'Y': this.applyGate1(qubits[0], GATES.Y); break;
      case 'Z': this.applyGate1(qubits[0], GATES.Z); break;
      case 'S': this.applyGate1(qubits[0], GATES.S); break;
      case 'RX': this.applyGate1(qubits[0], rx(param ?? 0)); break;
      case 'RY': this.applyGate1(qubits[0], ry(param ?? 0)); break;
      case 'RZ': this.applyGate1(qubits[0], rz(param ?? 0)); break;
      case 'CNOT': this.applyCNOT(qubits[0], qubits[1]); break;
      case 'CZ': this.applyCZ(qubits[0], qubits[1]); break;
      case 'CH': this.applyCH(qubits[0], qubits[1]); break;
      default: throw new Error(`Unknown gate ${gate}`);
    }
  }

  /** Apply a Pauli string (tensor product over qubits 0..n-1) */
  applyPauliString(paulis: Pauli[]) {
    for (let q = 0; q < this.n; q++) {
      const p = paulis[q];
      if (p === 'X') this.applyGate1(q, GATES.X);
      else if (p === 'Y') this.applyGate1(q, GATES.Y);
      else if (p === 'Z') this.applyGate1(q, GATES.Z);
    }
  }

  /** Expectation value <psi| P |psi> for a Hermitian Pauli string (real) */
  expectPauli(paulis: Pauli[]): number {
    const sv2 = this.clone();
    sv2.applyPauliString(paulis);
    let re = 0, im = 0;
    for (let i = 0; i < this.size; i++) {
      const pr = this.data[2 * i], pi = this.data[2 * i + 1];
      const sr = sv2.data[2 * i], si = sv2.data[2 * i + 1];
      re += pr * sr + pi * si;
      im += pr * si - pi * sr;
    }
    return re; // Hermitian => imaginary part ~ 0
  }

  /**
   * Projective measurement of a Pauli-string observable.
   * Returns sampled eigenvalue (+1/-1) and collapses the state.
   * `flipOutcome` applies a readout error: projects onto the wrong eigenspace.
   */
  measurePauli(paulis: Pauli[], rng: RNG, flipOutcome = false): { outcome: number; flipped: boolean } {
    const s = this.expectPauli(paulis);
    let pPlus = (1 + s) / 2;
    pPlus = Math.min(1, Math.max(0, pPlus));
    let wantPlus = rng() < pPlus;
    let flipped = false;
    if (flipOutcome) {
      wantPlus = !wantPlus;
      flipped = true;
    }
    const r = wantPlus ? 1 : -1;
    const svS = this.clone();
    svS.applyPauliString(paulis);
    const pR = wantPlus ? pPlus : 1 - pPlus;
    if (pR < 1e-12) {
      // numerically impossible outcome; re-measure without flip
      return this.measurePauli(paulis, rng, false);
    }
    const inv = 1 / (2 * Math.sqrt(pR));
    const d = this.data, sd = svS.data;
    for (let i = 0; i < d.length; i++) {
      d[i] = inv * (d[i] + r * sd[i]);
    }
    return { outcome: r, flipped };
  }

  /** Probability that qubit q is |1> (marginal) */
  probOne(q: number): number {
    const bit = 1 << q;
    let p = 0;
    for (let i = 0; i < this.size; i++) {
      if (i & bit) p += this.data[2 * i] ** 2 + this.data[2 * i + 1] ** 2;
    }
    return p;
  }

  /** Partial trace onto qubit 0 -> 2x2 density matrix
   *  returns [r00re, r00im, r01re, r01im, r10re, r10im, r11re, r11im]
   */
  partialTraceQ0(): number[] {
    const rho = new Float64Array(8);
    const rest = this.size >> 1;
    for (let b = 0; b < rest; b++) {
      const i0 = b * 2;      // qubit0 = 0
      const i1 = b * 2 + 1;  // qubit0 = 1
      const a0r = this.data[2 * i0], a0i = this.data[2 * i0 + 1];
      const a1r = this.data[2 * i1], a1i = this.data[2 * i1 + 1];
      rho[0] += a0r * a0r + a0i * a0i;          // r00
      rho[6] += a1r * a1r + a1i * a1i;          // r11
      rho[2] += a0r * a1r + a0i * a1i;          // r01 re
      rho[3] += a0i * a1r - a0r * a1i;          // r01 im
    }
    rho[4] = rho[2];
    rho[5] = -rho[3];
    return Array.from(rho);
  }

  /** Top amplitudes above threshold, formatted for UI */
  topAmplitudes(threshold = 0.01, maxCount = 8): { label: string; re: number; im: number; prob: number }[] {
    const out: { label: string; re: number; im: number; prob: number }[] = [];
    for (let i = 0; i < this.size; i++) {
      const prob = this.data[2 * i] ** 2 + this.data[2 * i + 1] ** 2;
      if (prob >= threshold) {
        out.push({
          label: '|' + i.toString(2).padStart(this.n, '0') + '>',
          re: this.data[2 * i],
          im: this.data[2 * i + 1],
          prob,
        });
      }
    }
    out.sort((a, b) => b.prob - a.prob);
    return out.slice(0, maxCount);
  }
}

/** Fidelity between prepared single-qubit state (theta, phi) and 2x2 rho */
export function fidelityFromRho(rho: number[], theta: number, phi: number): number {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  const p00 = rho[0], p01r = rho[2], p01i = rho[3], p11 = rho[6];
  // <psi|rho|psi> = c^2 r00 + s^2 r11 + 2cs·Re(e^{+i phi}·rho01)
  // Re(e^{i phi}(r01r + i r01i)) = r01r·cos(phi) - r01i·sin(phi)
  const term = p01r * Math.cos(phi) - p01i * Math.sin(phi);
  return c * c * p00 + s * s * p11 + 2 * c * s * term;
}

export function blochFromRho(rho: number[]): { x: number; y: number; z: number } {
  return {
    x: 2 * rho[2],
    y: -2 * rho[3],
    z: rho[0] - rho[6],
  };
}
