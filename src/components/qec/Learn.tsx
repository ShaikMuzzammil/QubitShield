'use client';

/**
 * Learn (v4 Compact Edition) — a SMALL, fast-reading guide:
 * a compact "how to use" box, six short core ideas, the QEC loop,
 * a trimmed glossary and an honest FAQ. Every card cross-links to
 * the lab where the concept can be tried live.
 */

import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Atom, Orbit, ShieldCheck, Gauge, Waves, Search, Activity, ArrowRight,
  Boxes, CircleHelp, GraduationCap, MousePointerClick, BarChart3, BookOpen,
} from 'lucide-react';

const HOWTO = [
  {
    icon: MousePointerClick,
    title: 'Run a shot',
    body: 'Simulator Lab → press Run Shot. Defaults match our Phase-1 example.',
    tab: 'simulator',
  },
  {
    icon: BarChart3,
    title: 'Read the outputs',
    body: 'Each result has three tabs: Results · How computed · What it means.',
    tab: 'simulator',
  },
  {
    icon: Orbit,
    title: 'Watch it in 3D',
    body: '3D Quantum Lab → 2 live Bloch-sphere sims. Press Run — each plays once, then stops. Drag to orbit.',
    tab: 'lab3d',
  },
  {
    icon: GraduationCap,
    title: 'Go deeper',
    body: 'Every input has a ? explainer; Performance Lab runs the statistics.',
    tab: 'performance',
  },
];

const COURSE = [
  {
    icon: Atom,
    title: 'Qubit & superposition',
    body: 'A qubit can be a blend — α|0⟩ + β|1⟩ — of both values at once. Squaring an amplitude gives its measurement probability.',
    tab: 'simulator',
  },
  {
    icon: Orbit,
    title: 'Bloch sphere',
    body: 'Every qubit state is an arrow on a sphere: poles are |0⟩ and |1⟩, the equator holds equal mixes like |+⟩. θ and φ place the arrow.',
    tab: 'lab3d',
  },
  {
    icon: Search,
    title: 'Measurement destroys',
    body: 'Looking at a qubit forces it to choose 0 or 1 — the blend is gone. So QEC must detect errors without reading the data.',
    tab: 'simulator',
  },
  {
    icon: Boxes,
    title: 'Entanglement',
    body: 'Encoded information lives in correlations BETWEEN qubits, not in any single one — so one error cannot destroy it.',
    tab: 'simulator',
  },
  {
    icon: Waves,
    title: 'Noise & decoherence',
    body: 'Real qubits get flipped (X), dephased (Z), or hit by a random mix of both (depolarizing). Left alone, quantum data melts.',
    tab: 'noise',
  },
  {
    icon: CircleHelp,
    title: 'Why errors are THE problem',
    body: 'No-cloning forbids backups, errors are continuous, and checking destroys — so QEC had to invent a brand-new playbook.',
    tab: 'simulator',
  },
];

const QEC_STEPS = [
  { icon: ShieldCheck, title: '1 · Encode', body: 'Spread 1 logical qubit across n physical ones (|0⟩ → |000⟩).', tab: 'simulator' },
  { icon: Search, title: '2 · Detect', body: 'Stabilizer parity checks reveal WHICH error — never the data.', tab: 'simulator' },
  { icon: Gauge, title: '3 · Correct', body: 'A decoder maps syndrome → most likely error → inverse fix.', tab: 'lab3d' },
  { icon: Activity, title: '4 · Outperform', body: 'Monte Carlo proves the protected qubit wins below threshold.', tab: 'performance' },
];

const GLOSSARY: [string, string][] = [
  ['Qubit', 'The quantum bit: exists as a superposition α|0⟩ + β|1⟩ and can be entangled with other qubits.'],
  ['Superposition', 'A weighted blend of basis states; measuring collapses it to one outcome with probability |amplitude|².'],
  ['Bloch sphere', 'The map of every single-qubit state as an arrow: poles = |0⟩ / |1⟩, equator = equal mixes differing in phase.'],
  ['Entanglement', 'Multi-qubit correlations with no classical equivalent — where QEC hides the information.'],
  ['Decoherence', 'The loss of quantum information to the environment. The enemy QEC fights.'],
  ['Bit-flip X / Phase-flip Z', 'X swaps |0⟩↔|1⟩; Z flips the sign of the |1⟩ amplitude — invisible to classical checks.'],
  ['Depolarizing noise', 'The standard benchmark channel: when hit, a qubit suffers a random X, Y or Z.'],
  ['Amplitude damping', 'Energy leakage: |1⟩ decays toward |0⟩. Non-Pauli — a Pauli fix cannot undo it perfectly.'],
  ['Coherent error', 'A systematic unitary mistake (e.g. every gate over-rotates 3°) — accumulates faster than random noise.'],
  ['Code [[n,k,d]]', 'Encodes k logical qubits into n physical qubits with distance d — fixes ⌊(d−1)/2⌋ errors.'],
  ['Stabilizer / Syndrome', 'Parity checks that all valid code states satisfy. The pattern of their answers (the syndrome) points to the error like a smoke alarm.'],
  ['Decoder / MWPM', 'Translates syndrome → correction. Surface codes use minimum-weight perfect matching: pair defects along lightest paths.'],
  ['Surface code', 'Qubits on a 2-D lattice with nearest-neighbour checks — the leading hardware candidate (threshold ≈ 1%).'],
  ['Logical vs physical qubit', 'Physical = noisy hardware qubits; logical = the protected qubit they jointly implement.'],
  ['Fidelity F', 'How close the recovered state is to the target. 100% = identical. The headline score of every lab here.'],
  ['Pseudo-threshold', 'The noise level where QEC stops helping: below it bigger codes win, above it they lose.'],
];

const FAQ: [string, string][] = [
  ['Why can\'t we just copy quantum data as a backup?', 'The no-cloning theorem forbids copying unknown quantum states. QEC sidesteps this by spreading information across entangled qubits — never copying it.'],
  ['What does "99% fidelity" mean?', 'The recovered state overlaps the intended state to 99% — measurements on it match the perfect state 99% of the time. The remaining 1% is genuine quantum damage.'],
  ['More qubits make things LESS noisy?', 'That\'s the magic: extra qubits add error surface, but the code turns single errors into detectable patterns. Below threshold, detection wins — d=7 fails exponentially less than d=3.'],
  ['A shot said "partial recovery" — is it broken?', 'No — honest physics. Pauli codes perfectly reverse Pauli errors; non-Pauli channels (damping, coherent tilt) also squeeze the state in ways a Pauli fix can\'t fully undo.'],
  ['Is this how real quantum computers do it?', 'Yes — the encode → syndrome → correct loop is the real playbook (Google\'s Willow demonstrated exactly this surface-code scaling). The decoders differ; the principle is the same.'],
];

export default function Learn({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      {/* compact header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100">
          <GraduationCap className="h-5 w-5 text-amber-300" /> Learn — the plain-language guide
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          How to use the simulator, the six core ideas, and every term you will meet. Read a little, click a little.
        </p>
      </div>

      {/* How to use — SMALL box */}
      <div className="rounded-xl border border-amber-500/25 bg-gradient-to-r from-[#1d1606] to-[#141126] p-4">
        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-amber-200">
          <MousePointerClick className="h-4 w-4" /> How to use this simulator — 4 steps
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {HOWTO.map((s, i) => (
            <button
              key={s.title}
              onClick={() => onNavigate?.(s.tab)}
              className="group flex items-start gap-2.5 rounded-lg border glass border-white/8/80 p-3 text-left transition-colors hover:border-amber-500/40"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 font-mono text-[11px] font-bold text-amber-300">{i + 1}</span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-100">{s.title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{s.body}</span>
                <span className="mt-1 inline-flex items-center text-[10px] text-amber-300/90 group-hover:text-amber-200">
                  open <ArrowRight className="ml-0.5 h-2.5 w-2.5" />
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* six ideas — compact */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-100">
          <BookOpen className="h-4.5 w-4.5 text-amber-300" /> Quantum computing in six ideas
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {COURSE.map((c) => (
            <button
              key={c.title}
              onClick={() => onNavigate?.(c.tab)}
              className="flex items-start gap-3 rounded-xl border glass border-white/8 p-4 text-left transition-colors hover:border-violet-500/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                <c.icon className="h-4.5 w-4.5 text-amber-300" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-100">{c.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-400">{c.body}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* QEC loop — compact strip */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-100">
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-300" /> How error correction protects a qubit
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {QEC_STEPS.map((s) => (
            <button
              key={s.title}
              onClick={() => onNavigate?.(s.tab)}
              className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-[#101a14] p-4 text-left transition-colors hover:border-emerald-500/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                <s.icon className="h-4.5 w-4.5 text-emerald-300" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-100">{s.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-400">{s.body}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* glossary — trimmed */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-100">Glossary — the essential terms</h2>
        <p className="mb-3 text-sm text-slate-500">Tap any term for a one-sentence, jargon-free definition.</p>
        <Accordion type="single" collapsible className="rounded-xl border glass border-white/8 px-5">
          {GLOSSARY.map(([term, def], i) => (
            <AccordionItem key={term} value={`g-${i}`} className="last:border-b-0">
              <AccordionTrigger className="py-3 text-left text-sm font-medium text-slate-200 hover:no-underline hover:text-violet-200">
                {term}
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-slate-400">{def}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* FAQ — trimmed */}
      <section>
        <h2 className="mb-1 text-lg font-semibold text-slate-100">Honest FAQ</h2>
        <Accordion type="single" collapsible className="rounded-xl border border-cyan-500/20 bg-[#101822] px-5">
          {FAQ.map(([q, a], i) => (
            <AccordionItem key={q} value={`f-${i}`} className="last:border-b-0">
              <AccordionTrigger className="py-3 text-left text-sm font-medium text-slate-200 hover:no-underline hover:text-cyan-200">
                {q}
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-slate-400">{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
