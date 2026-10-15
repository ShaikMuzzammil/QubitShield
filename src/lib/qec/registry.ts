/**
 * UI-facing registry: combines codes, noise models and engine capabilities
 * into a single source of truth for the interface.
 *
 * SCOPE — exactly the two QEC codes of all_with_noise_prob.py, each combinable
 * with all three of its noise channels (bit-flip / phase-flip / depolarizing).
 */
import { SV_CODES, SVCodeDef } from './codes';
import { NOISE_MODELS, NoiseModelId } from './noise';

export interface CodeMeta {
  id: string;
  name: string;
  short: string;
  n: number;
  k: number;
  d: number;
  family: string;
  corrects: string;
  description: string;
  engine: 'statevector';
  stabilizerCount: number;
  rate: string;
  compat: NoiseModelId[];
  color: string;
}

const COMPAT: NoiseModelId[] = ['bitflip', 'phaseflip', 'depolarizing'];

export const CODE_REGISTRY: CodeMeta[] =
  SV_CODES.map((c: SVCodeDef) => ({
    id: c.id,
    name: c.name,
    short: c.short,
    n: c.n,
    k: c.k,
    d: c.d,
    family: c.family,
    corrects: c.corrects,
    description: c.description,
    engine: 'statevector' as const,
    stabilizerCount: c.stabilizers.length,
    rate: `${c.k}/${c.n}`,
    compat: COMPAT,
    color: 'violet',
  }));

export function getCodeMeta(id: string): CodeMeta {
  const c = CODE_REGISTRY.find((c) => c.id === id);
  if (!c) throw new Error(`Unknown code ${id}`);
  return c;
}

export { NOISE_MODELS };
export type { NoiseModelId };
