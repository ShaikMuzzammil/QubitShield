'use client';

import { useState } from 'react';
import { Atom, Activity, Boxes, BookOpen, Info, Orbit, Users, GraduationCap, Layers } from 'lucide-react';
import Overview from '@/components/qec/Overview';
import SimulatorLab from '@/components/qec/SimulatorLab';
import PerformanceLab from '@/components/qec/PerformanceLab';
import QuantumLab3D from '@/components/qec/QuantumLab3D';
import Learn from '@/components/qec/Learn';
import { CodeGallery, NoiseGallery, Literature, About } from '@/components/qec/Galleries';
import { GuideModeProvider } from '@/components/qec/Guide';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Boxes },
  { id: 'simulator', label: 'Simulator Lab', icon: Atom },
  { id: 'lab3d', label: '3D Quantum Lab', icon: Orbit },
  { id: 'performance', label: 'Performance Lab', icon: Activity },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'reference', label: 'Reference', icon: Layers },
  { id: 'about', label: 'About', icon: Info },
];

/* Legacy tab ids (from links inside Overview/Learn) map into the Reference tab */
const REFERENCE_SUBS = ['codes', 'noise', 'literature'] as const;
type ReferenceSub = (typeof REFERENCE_SUBS)[number];

const TEAM = 'K. Devendra Reddy · Shaik Muzzammil · D. Guna Samhith';

/* ------------------------------------------------------------------ */
/* Reference tab — QEC Codes + Noise Models + Literature in ONE place   */
/* ------------------------------------------------------------------ */
function Reference({ sub, setSub }: { sub: ReferenceSub; setSub: (s: ReferenceSub) => void }) {
  const chips: { id: ReferenceSub; label: string }[] = [
    { id: 'codes', label: 'QEC Codes' },
    { id: 'noise', label: 'Noise Models' },
    { id: 'literature', label: 'Literature' },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-xl font-semibold text-slate-100">Reference</h2>
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setSub(c.id)}
            className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition-all ${
              sub === c.id
                ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.15)]'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-violet-400/40 hover:text-slate-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {sub === 'codes' && <CodeGallery />}
      {sub === 'noise' && <NoiseGallery />}
      {sub === 'literature' && <Literature />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aurora backdrop — layered static glow with a very slow, cheap drift  */
/* ------------------------------------------------------------------ */
function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[#07060f]" />
      <div className="aurora-blob aurora-drift-a -top-40 right-[6%] h-[520px] w-[520px] bg-violet-700/20" />
      <div className="aurora-blob aurora-drift-b bottom-[-200px] left-[2%] h-[480px] w-[480px] bg-cyan-600/14" />
      <div className="aurora-blob left-[34%] top-[26%] h-[380px] w-[380px] bg-fuchsia-700/10" />
      {/* fine grid — barely visible, gives depth */}
      <div
        className="absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.07) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 65% at 50% 0%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 65% at 50% 0%, black 30%, transparent 100%)',
        }}
      />
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState('overview');
  const [refSub, setRefSub] = useState<ReferenceSub>('codes');

  // Single navigation entry point: legacy ids ('codes' | 'noise' | 'literature')
  // land on the Reference tab with the right chip pre-selected.
  const navigate = (id: string) => {
    if (REFERENCE_SUBS.includes(id as ReferenceSub)) {
      setRefSub(id as ReferenceSub);
      setTab('reference');
      return;
    }
    setTab(id);
  };

  return (
    <GuideModeProvider>
    <div className="relative flex min-h-screen flex-col text-slate-200">
      <AuroraBackdrop />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#07060f]/80 backdrop-blur-xl">
        <div className="hairline absolute inset-x-0 bottom-0" />
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-violet-500 to-cyan-500 shadow-[0_0_28px_rgba(139,92,246,0.5)]">
            <Atom className="h-5.5 w-5.5 text-white" />
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 pulse-dot" aria-hidden />
          </div>
          <div className="mr-auto">
            <div className="text-base font-bold leading-tight tracking-tight">
              <span className="text-gradient-hero">QEC Simulator</span>
              <span className="ml-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wider text-violet-300">
                v12
              </span>
            </div>
            <div className="text-[10px] leading-tight text-slate-500">
              Interactive Quantum Error Correction · live in your browser
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-3 py-1 text-[10px] font-medium text-emerald-300 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" aria-hidden />
            Live engine · verified tests green
          </span>
        </div>
        {/* Tabs */}
        <nav className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2.5" aria-label="Sections">
          <div className="flex gap-1.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    active
                      ? 'bg-gradient-to-b from-violet-500/30 to-violet-600/15 text-violet-100 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.45),0_4px_16px_-6px_rgba(139,92,246,0.5)]'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? 'text-violet-300' : ''}`} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {tab === 'overview' && <Overview onNavigate={navigate} />}
        {tab === 'simulator' && <SimulatorLab onNavigate={navigate} />}
        {tab === 'lab3d' && <QuantumLab3D />}
        {tab === 'performance' && <PerformanceLab onNavigate={navigate} />}
        {tab === 'learn' && <Learn onNavigate={navigate} />}
        {tab === 'reference' && <Reference sub={refSub} setSub={setRefSub} />}
        {tab === 'about' && <About />}
      </main>

      {/* Footer — project authors */}
      <footer className="mt-auto border-t border-white/8 bg-[#0a0817]/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-[11px] text-slate-500">
          <span>Interactive Quantum Error Correction Simulator — all simulation runs locally in your browser.</span>
          <span className="flex items-center gap-1.5 font-medium text-slate-400">
            <Users className="h-3.5 w-3.5 text-violet-400" />
            {TEAM}
          </span>
        </div>
      </footer>
    </div>
    </GuideModeProvider>
  );
}
