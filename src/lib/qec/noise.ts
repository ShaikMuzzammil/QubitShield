/**
 * Noise models for QEC simulation.
 *
 * SCOPE — exactly the three channels implemented in all_with_noise_prob.py
 * (build_noise_model): 1 = Bit-Flip (X), 2 = Phase-Flip (Z), 3 = Depolarizing.
 *
 * Each model samples discrete error events per qubit (quantum-trajectory style)
 * and can also describe itself analytically for UI display.
 */
import { StateVector, RNG, GATES } from './engine';

export type NoiseModelId =
  | 'bitflip'
  | 'phaseflip'
  | 'depolarizing';

export interface NoiseParams {
  /** main error probability (0..1) */
  p: number;
  /** syndrome readout error probability */
  pMeas?: number;
}

export type ErrorKind = 'X' | 'Y' | 'Z';

/**
 * Build NoiseParams for the selected channel — one knob, p, exactly like
 * the probability input of all_with_noise_prob.py.
 */
export function noiseParams(p: number, _noise?: NoiseModelId, opts?: { pMeas?: number }): NoiseParams {
  return { p, pMeas: opts?.pMeas };
}

export interface NoiseEvent {
  qubit: number;      // for XX: first qubit of the pair
  qubit2?: number;    // for XX
  kind: ErrorKind;
  prob: number;       // channel probability that produced this event
}

export interface NoiseModelInfo {
  id: NoiseModelId;
  name: string;
  short: string;
  description: string;
  math: string;
  pauliOnly: boolean; // can be used with the surface-code Pauli-frame engine
  mainParam: string;
}

export const NOISE_MODELS: NoiseModelInfo[] = [
  {
    id: 'bitflip',
    name: 'Bit-Flip (X) Noise',
    short: 'Bit-flip',
    description:
      'A spurious Pauli-X gate flips the qubit state: |0> becomes |1> and vice versa. ' +
      'Classically analogous to a bit flip, this is the simplest quantum error and the one ' +
      'the 3-qubit repetition code was designed for.',
    math: 'E(ρ) = (1−p)·ρ + p·XρX',
    pauliOnly: true,
    mainParam: 'Flip probability p',
  },
  {
    id: 'phaseflip',
    name: 'Phase-Flip (Z) Noise',
    short: 'Phase-flip',
    description:
      'A Pauli-Z gate flips the relative phase of a superposition: |+> becomes |−>. ' +
      'This error has no classical analogue and is invisible to bit-flip codes — ' +
      'motivating the 3-qubit Phase-Flip code.',
    math: 'E(ρ) = (1−p)·ρ + p·ZρZ',
    pauliOnly: true,
    mainParam: 'Phase-flip probability p',
  },
  {
    id: 'depolarizing',
    name: 'Depolarizing Noise',
    short: 'Depolarizing',
    description:
      'The standard "gold standard" noise model: with probability p the qubit is hit by a ' +
      'randomly chosen Pauli error (X, Y or Z, each p/3). Fully depolarizes the qubit when p = 1.',
    math: 'E(ρ) = (1−p)·ρ + p/3·(XρX + YρY + ZρZ)',
    pauliOnly: true,
    mainParam: 'Depolarizing probability p',
  },
];

export function getNoiseModel(id: NoiseModelId): NoiseModelInfo {
  return NOISE_MODELS.find((m) => m.id === id)!;
}

/**
 * Apply one noise layer to a state vector (quantum trajectories).
 * Returns the list of sampled error events for display.
 */
export function applyNoiseLayer(
  sv: StateVector,
  model: NoiseModelId,
  params: NoiseParams,
  rng: RNG,
  qubits?: number[]
): NoiseEvent[] {
  const qs = qubits ?? Array.from({ length: sv.n }, (_, i) => i);
  const events: NoiseEvent[] = [];
  const p = params.p;

  switch (model) {
    case 'bitflip':
      for (const q of qs) {
        if (rng() < p) {
          sv.applyGate1(q, GATES.X);
          events.push({ qubit: q, kind: 'X', prob: p });
        }
      }
      break;

    case 'phaseflip':
      for (const q of qs) {
        if (rng() < p) {
          sv.applyGate1(q, GATES.Z);
          events.push({ qubit: q, kind: 'Z', prob: p });
        }
      }
      break;

    case 'depolarizing':
      for (const q of qs) {
        const r = rng();
        if (r < p) {
          const which = rng();
          const kind: ErrorKind = which < 1 / 3 ? 'X' : which < 2 / 3 ? 'Y' : 'Z';
          sv.applyGate1(q, kind === 'X' ? GATES.X : kind === 'Y' ? GATES.Y : GATES.Z);
          events.push({ qubit: q, kind, prob: p / 3 });
        }
      }
      break;
  }

  return events;
}

/** Analytic fidelity of a bare (unprotected) single qubit under each noise model. */
export function bareQubitFidelity(model: NoiseModelId, params: NoiseParams, theta: number, phi: number): number {
  const c = Math.cos(theta / 2), s = Math.sin(theta / 2);
  const p = params.p;
  const zExp = c * c - s * s;               // <Z>
  const xExp = 2 * c * s * Math.cos(phi);  // <X>
  switch (model) {
    case 'bitflip':
      // F = (1-p)*1 + p*<psi|X|psi>^2
      return (1 - p) + p * xExp * xExp;
    case 'phaseflip':
      return (1 - p) + p * zExp * zExp;
    case 'depolarizing':
      return 1 - (2 / 3) * p;
    default:
      return 1;
  }
}
