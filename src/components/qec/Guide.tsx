'use client';

/**
 * Guide system (v4 "Compact & Understandable Edition")
 *
 * Makes every input and every output self-explanatory — ALWAYS ON, no toggle:
 *
 *  - GuideModeProvider : global guide context (always-on in v4; the former
 *                        ON/OFF toggle was removed per user feedback).
 *  - InfoDot           : the small "?" button next to any control; expands a
 *                        plain-English panel — What it is / How to use it / Example.
 *  - GuideField        : a labelled input row with a one-line hint + InfoDot.
 *  - HowToCard         : compact collapsible "How to use this lab" box (collapsed
 *                        by default so pages stay clean).
 *  - ResultTabs        : the three separated output tabs —
 *                        Results | How it was computed | What it means.
 *  - StepList          : numbered walkthrough timeline (used inside the How tab).
 *  - MeaningCard       : one interpretation card (used inside the Meaning tab).
 *  - TryBox            : "try this experiment" suggestion strip.
 */

import { createContext, useContext, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart3, Workflow, Lightbulb, GraduationCap, ChevronDown, FlaskConical, HelpCircle } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Guide context — always on in v4 (toggle removed per user feedback)  */
/* ------------------------------------------------------------------ */

interface GuideMode {
  beginner: boolean;
  setBeginner: (b: boolean) => void;
}

const GuideCtx = createContext<GuideMode>({ beginner: true, setBeginner: () => {} });

export function GuideModeProvider({ children }: { children: React.ReactNode }) {
  // Guides are always on — the v4 compact edition keeps every explanation
  // visible without a mode switch.
  return <GuideCtx.Provider value={{ beginner: true, setBeginner: () => {} }}>{children}</GuideCtx.Provider>;
}

export function useGuideMode() {
  return useContext(GuideCtx);
}

/* ------------------------------------------------------------------ */
/* InfoDot — the "?" explainer                                          */
/* ------------------------------------------------------------------ */

export interface GuideInfo {
  /** What is this control / value? */
  what: string;
  /** How do I use / choose it? */
  how: string;
  /** A concrete example. */
  example?: string;
}

export function InfoDot({ info, title }: { info: GuideInfo; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex w-full flex-col">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Explain: ${title}`}
        title={`Explain: ${title}`}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition-all ${
          open
            ? 'border-cyan-300 bg-cyan-400/25 text-cyan-100 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
            : 'border-cyan-400/40 bg-cyan-500/5 text-cyan-300/90 hover:border-cyan-300 hover:bg-cyan-400/15'
        }`}
      >
        ?
      </button>
      {open && (
        <span className="glass-deep pop-in mt-2 block w-full rounded-xl border-cyan-400/20 p-3 text-left">
          <span className="mb-1 flex items-start justify-between gap-2">
            <span className="text-[11px] font-semibold text-cyan-200">{title}</span>
            <button onClick={() => setOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-300" aria-label="Close explanation">✕ close</button>
          </span>
          <span className="block text-xs leading-relaxed text-slate-300">
            <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-cyan-400">What it is</span>
            {info.what}
          </span>
          <span className="mt-2 block text-xs leading-relaxed text-slate-300">
            <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-violet-400">How to use it</span>
            {info.how}
          </span>
          {info.example && (
            <span className="mt-2 block text-xs leading-relaxed text-slate-300">
              <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-emerald-400">Example</span>
              {info.example}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* GuideField — labelled control row                                    */
/* ------------------------------------------------------------------ */

export function GuideField({ label, info, hint, right, children }: {
  label: string;
  info: GuideInfo;
  /** one-line beginner hint shown under the label when Guide Mode is ON */
  hint?: string;
  /** right-aligned slot (e.g. live value display) */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { beginner } = useGuideMode();
  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-xs font-medium text-slate-300">{label}</label>
        {right && <span className="ml-auto">{right}</span>}
        <span className={right ? '' : 'ml-auto'}>
          <InfoDot info={info} title={label} />
        </span>
      </div>
      {beginner && hint && <p className="-mt-0.5 mb-1.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
      {/* children rendered by caller */}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HowToCard — compact collapsible "How to use this lab" box            */
/* (collapsed by default — a small box, per v4 feedback)                */
/* ------------------------------------------------------------------ */

export function HowToCard({ title = 'How to use this lab', steps, tip }: {
  title?: string;
  steps: { title: string; body: string }[];
  tip?: string;
}) {
  // Collapsed by default — the compact edition. null = follow the default;
  // a boolean = the user's explicit expand/collapse override.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? false;

  return (
    <div className="glass overflow-hidden rounded-xl">
      <button
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <GraduationCap className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="text-xs font-semibold text-amber-200">{title}</span>
        <span className="ml-2 hidden text-[10px] text-slate-500 sm:inline">{open ? 'tap to hide' : 'tap for simple steps'}</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-amber-300/70 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-amber-400/10 px-4 py-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((s, i) => (
              <div key={s.title} className="flex gap-2 rounded-lg border border-white/8 bg-white/[0.03] p-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 font-mono text-[10px] font-bold text-amber-300">{i + 1}</span>
                <div>
                  <div className="text-[11px] font-semibold text-slate-100">{s.title}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">{s.body}</div>
                </div>
              </div>
            ))}
          </div>
          {tip && (
            <p className="mt-2.5 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-200/80">
              <FlaskConical className="mt-0.5 h-3 w-3 shrink-0" /> {tip}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ResultTabs — Results | How it was computed | What it means           */
/* ------------------------------------------------------------------ */

export type ResultTabKey = 'results' | 'how' | 'meaning';

export function ResultTabs({ results, how, meaning, initial = 'results' }: {
  results: React.ReactNode;
  how: React.ReactNode;
  meaning: React.ReactNode;
  initial?: ResultTabKey;
}) {
  const [tab, setTab] = useState<ResultTabKey>(initial);
  const tabs: { key: ResultTabKey; label: string; icon: typeof BarChart3; color: string }[] = [
    { key: 'results', label: 'Results', icon: BarChart3, color: 'text-emerald-300' },
    { key: 'how', label: 'How it was computed', icon: Workflow, color: 'text-cyan-300' },
    { key: 'meaning', label: 'What it means', icon: Lightbulb, color: 'text-amber-300' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Result explanation tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                on
                  ? 'border-violet-400/50 bg-violet-500/20 text-violet-100 shadow-[0_0_18px_rgba(139,92,246,0.22)]'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-violet-400/40 hover:text-slate-200'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${on ? t.color : ''}`} />
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="flex flex-col gap-4">
        {tab === 'results' && results}
        {tab === 'how' && (
          <div className="glass rounded-xl border-cyan-400/15 p-5">
            {how}
          </div>
        )}
        {tab === 'meaning' && <div className="flex flex-col gap-3">{meaning}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StepList — numbered walkthrough                                      */
/* ------------------------------------------------------------------ */

export function StepList({ steps }: { steps: { title: string; body: React.ReactNode }[] }) {
  return (
    <ol className="relative flex flex-col gap-4">
      {steps.map((s, i) => (
        <li key={i} className="relative flex gap-3 pl-1">
          {i < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-gradient-to-b from-cyan-500/40 to-transparent" />}
          <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 font-mono text-xs font-bold text-cyan-300">{i + 1}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-xs font-semibold text-cyan-100">{s.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-300">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* MeaningCard + TryBox                                                 */
/* ------------------------------------------------------------------ */

const TONES = {
  good: 'border-emerald-400/25 bg-emerald-400/[0.06]',
  info: 'border-cyan-400/25 bg-cyan-400/[0.06]',
  warn: 'border-amber-400/25 bg-amber-400/[0.06]',
  violet: 'border-violet-400/25 bg-violet-400/[0.06]',
} as const;

export function MeaningCard({ title, tone = 'violet', children }: {
  title: string;
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-4 ${TONES[tone]}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-100">
        <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
        {title}
      </div>
      <div className="text-xs leading-relaxed text-slate-300">{children}</div>
    </div>
  );
}

export function TryBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-400/25 bg-gradient-to-r from-amber-500/[0.08] to-transparent p-4">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
        <FlaskConical className="h-3.5 w-3.5" /> Try this experiment
      </div>
      <div className="text-xs leading-relaxed text-amber-100/80">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MiniStat — compact labelled value used in explanations               */
/* ------------------------------------------------------------------ */

export function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-100';
  return (
    <span className="inline-flex flex-col rounded-md border border-violet-400/25 bg-violet-500/10 px-2.5 py-1.5">
      <span className="text-[9px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
    </span>
  );
}

export { HelpCircle };
