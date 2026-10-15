# QEC Simulator — Phase 2 Prototype (v12 · Perfect-Alignment Edition)

**Interactive Quantum Error Correction Simulator — scoped exactly to our reference program `all_with_noise_prob.py` (plus the Shor 9-qubit upgrade).**

College project · **AMRITA VISHWA VIDYAPEETHAM**
Team: K. Devendra Reddy (CH.SC.U4CSE24021) · Shaik Muzzammil (CH.SC.U4CSE24041) · D. Guna Samhith (CH.SC.U4CSE24016)

---

## What this prototype is

This prototype implements the scope of our reference implementation `all_with_noise_prob.py` (Qiskit + Qiskit Aer) — **its 3 noise models and its QEC codes** — plus the user-requested **Shor 9-qubit code**, and every number on every tab is computed live in your browser by a verified state-vector engine. There is no mock data anywhere in the app: press Run and the engine really encodes, applies noise, measures syndromes, corrects, decodes and measures.

| Reference program (Python) | This prototype (browser) |
|---|---|
| `bit_flip_qec(input_bit, error_qubit)` — 5 qubits, 3 classical bits | Simulator Lab → **3-Qubit Bit-Flip Code** [[3,1,3]] |
| `phase_flip_qec(input_bit, error_qubit)` — H-conjugated repetition | Simulator Lab → **3-Qubit Phase-Flip Code** [[3,1,3]] |
| *(upgrade)* any single X, Y or Z error — what depolarizing noise demands | Simulator Lab → **Shor 9-Qubit Code** [[9,1,3]] |
| `build_noise_model` — 1. Bit-Flip (X) / 2. Phase-Flip (Z) / 3. Depolarizing, attached to the **ID gate** | The same three channels, sampled per qubit via quantum trajectories |
| `AerSimulator(noise_model=...).run(qc, shots=1000)` | Monte Carlo up to 25,000 shots + N-shot distribution runs, seeded and reproducible |
| counts → interpretation → performance analysis → syndrome table → circuit | The same outputs, plus the **full large pipeline circuit**, the 11-row output summary, and printable PDF (with circuit image) / JSON / CSV / PNG exports |

### What is new in v12 (the Perfect-Alignment & Bigger-3D edition)

- **Circuit stage headers can no longer overlap** — every stage band (INPUT / ENCODE / NOISE / SYNDROME / CORRECT / DECODE / MEASURE) now draws its title and hint on **two stacked lines clipped to its own band width**, so a narrow stage can never paint its label over the next one; the full description is a hover tooltip. Narrow bands show complete short hints (prep · encoding circuit · ID slots · stabilizer checks + measurement · recovery · inverse circuit · readout).
- **Breathing room restored** — rows, columns, gate cells and the header area grew slightly (+5–7%) after the v11 compacting pass; the layout is still far more compact than v10, fits the card with Fit-width, and every wire, label, sub-label (data / ancilla), classical bit box and legend is perfectly aligned.
- **Bigger 3D Quantum Lab** — all three visualizers grew: Bloch Sphere walkthrough 420→**520 px** and sphere scale ×1.09, Bloch Flight 4D 560→**640 px**, 3D Circuit & Error Propagation 430→**520 px** with a larger board scale.
- All 86 engine assertions, TypeScript and the production build remain green; the Phase-2 PPT was rebuilt with the newly aligned circuit capture (4580×2148) and freshly measured results.

<details>
<summary><b>What was new in v11 — the Compact-Circuit edition</b> (click to expand)</summary>

- **Circuits right-sized (not huge, not tiny)** — a new column-packing layout lets qubit-disjoint operations share the same circuit column, so the drawn pipeline is dramatically shorter while staying complete: the Shor circuit went from ~55 drawn columns to **37**, the 3-qubit codes from ~30 to **20–26**, and every gate cell was reduced ~18%. The whole pipeline still shows every stage (Input → Encode → Noise → Syndrome → Correct → Decode → Measure), ancillas, syndrome bits and live shot annotations — it now **fits the visible card** with the Fit-width toggle, and stays clearly readable at actual size.
- **Bloch Flight 4D fixed** — the flight canvas now renders its idle sphere, both arrows and the fidelity strip the moment the tab opens (previously it stayed black until the first Run). Verified: idle render + 30-round flight with QEC holding ~100% while the bare qubit decays.

</details>

<details>
<summary><b>What was new in v7 — the Large-Circuit edition</b> (click to expand)</summary>

- **Full large pipeline circuit** — every lab draws the complete circuit (Input → Encode → Noise slots → Syndrome with ancilla measurement → Conditional corrections → Decode → Measure) with stage bands, ancilla qubits and classical double-wires, exactly mirroring the printed circuit of `all_with_noise_prob.py`. Fit-width / actual-size toggle + **Circuit PNG download**.
- **Shor 9-Qubit Code** — corrects any single arbitrary error, verified for all 27 single-qubit (X/Y/Z × 9 qubits) cases; the right code under depolarizing noise.
- **Full Output Summary** — the complete requested output block in one table: input & encoded state, noise configuration (model, probability, affected qubits), syndrome bits + interpretation, decoder decision + recovery operation, measurement distribution, logical error rate, logical success rate, state fidelity, QEC-vs-bare comparison, runtime, reproducibility (shots / seed / engine / model settings).
- **Measurement distribution runs** — 100 / 200 / 500 / 1000-shot runs (chunked, UI stays responsive, live progress) with outcome histogram, top syndrome patterns and comparison charts.
- **Exports show how it came** — the PDF report embeds the circuit image, all inputs, all outputs and a numbered step-by-step "how this result was computed" walkthrough; JSON carries the same step log + full statistics; CSVs for amplitudes and distribution stats.
- **3D Circuit & Error Propagation** (new 3D-lab visualizer) — the selected code's encoding circuit as a 3D board: inject X/Z/Y at any qubit and any moment and watch the Pauli frame split and morph through the gates with exact Clifford rules (verified by tests). Below it, the same flat full-pipeline circuit with a live annotated shot.
- The Bloch Sphere walkthrough and Bloch Flight 4D remain fully working, engine-driven one-shot simulations.

</details>

### The physics (verified, not decorative)

The engine is covered by an **86-assertion** test suite:

```bash
bun scripts/test-qec.mjs          # 61 assertions — core engine, codes, pipeline
bun scripts/test-shor.mjs         #  8 assertions — Shor code correction (all 27 single-error cases)
bun scripts/test-propagation.mjs  # 17 assertions — exact Clifford error-propagation rules
```

- **Matched pairs recover perfectly**: bit-flip code + X noise and phase-flip code + Z noise fix every single error (F = 100% after correction). Syndrome mapping matches the Python table: 01→q0, 11→q1, 10→q2.
- **Shor corrects everything single**: X, Y and Z on each of the 9 qubits — all 27 cases — recover with F = 100%.
- **Monte Carlo matches theory**: bit-flip code success = (1−p)³ + 3p(1−p)² — the simulation lands on the analytic curve at every p (verified to ±1%).
- **Unmatched pairings behave honestly**: a Z error is invisible to the bit-flip code (trivial syndrome); an X error on the phase-flip code is undetectable — exactly like the Python program's NOT MATCHED status.
- **Noise channels sampled correctly**: bit-flip/phase-flip event rates match p; depolarizing picks X/Y/Z uniformly at p/3 each.
- **Error propagation follows exact Clifford conjugation**: X through a CNOT control copies to the target, Z through a CNOT target copies back to the control, H swaps X ↔ Z.

## The seven tabs

1. **Overview** — hero, Phase-1 objectives → implemented features, a **compact "How it works" worked example** (the exact Phase-1 scenario: X error on q1, live engine run, small collapsible box) and the pipeline architecture.
2. **Simulator Lab** — the full single-shot pipeline: code (3 codes) + noise + p + input state + manual error injection + seed → verdict with fidelity (with QEC vs bare), the **full large pipeline circuit** with your shot annotated on it, the **11-row full output summary**, distribution histograms, syndrome table, Bloch-sphere comparison, encoded-state inspector. Exports: **PDF report with embedded circuit image + step-by-step walkthrough**, **Circuit PNG**, JSON, CSV (amplitudes + distribution).
3. **3D Quantum Lab** — three real-time, engine-driven, one-shot visualizers:
   - **Bloch Sphere** — the FULL pipeline walked stage by stage on a live 3D sphere: Input → Encode → Noise → Syndrome → Correct → Decode → Measure. The state arrow really moves: watch the noise kick it away and the decoder snap it back.
   - **Bloch Flight 4D** — the logical qubit flying round after round through noise + correction cycles, with its time-colored trajectory trail (space + time = 4D) and the bare-qubit ghost for comparison.
   - **Circuit & Error Propagation** — the 3D circuit board with live error propagation, plus the flat full-pipeline circuit with a live annotated shot.
   - All three export a formal report (printable → PDF), JSON and CSV.
4. **Performance Lab** — Monte Carlo before/after (up to 25,000 shots, live-converging) + the fidelity-vs-p sweep (1%→50%) exposing each code's pseudo-threshold + **Code Showdown** ranking all three codes under identical noise. Exports: PDF report, JSON, CSV.
5. **Learn** — compact crash course: how to use the simulator, six core ideas, the QEC loop, glossary, FAQ.
6. **Reference** — the three QEC codes (with encoding circuits + stabilizers), the three noise models, and the 10-paper Phase-1 literature review.
7. **About** — college, team, engine highlights, tech stack, what's new in this edition.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui
- Recharts for statistics; custom SVG for circuits / Bloch spheres; custom zero-dependency Canvas 3D engine (`three-d.ts`)
- From-scratch state-vector engine (`engine.ts`) with projective stabilizer measurement + quantum-trajectory noise sampling
- Reference program: Qiskit + Qiskit Aer (`all_with_noise_prob.py`, included in the project zip)

## Run locally

```bash
bun install        # or npm install
bun run dev        # or npm run dev  → http://localhost:3000
bun run test       # engine verification suite (61 assertions)
bun run lint       # eslint
bun run build      # production build (what Vercel runs)
```

---

## Deploy to Vercel (step by step, after a GitHub push)

The project is a standard Next.js 16 App Router app — Vercel detects it automatically. No environment variables, no database, no server: everything runs client-side.

### 1. Push the project to GitHub

```bash
cd qec-simulator
git init
git add .
git commit -m "QEC Simulator - Phase 2 prototype (compact-circuit edition)"
git branch -M main
git remote add origin https://github.com/<your-username>/qec-simulator.git
git push -u origin main
```

> Tip: if you downloaded the project as a ZIP, unzip it first and make sure you can run `bun run dev` locally before pushing. Do NOT commit `node_modules/` (the included `.gitignore` already excludes it).

### 2. Create the Vercel project

1. Go to **https://vercel.com** and sign in (a GitHub account is enough — the free Hobby plan is fine).
2. Click **Add New → Project**.
3. In **Import Git Repository**, find `qec-simulator` and click **Import**.
   - If it is not listed, click **Adjust GitHub App Permissions** and give Vercel access to the repo first.

### 3. Configure the project (defaults are correct)

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** (auto-detected) |
| Root Directory | `./` (leave as is — `package.json` is in the repo root) |
| Build Command | `next build` (default — leave empty to use the default) |
| Output Directory | `.next` (default) |
| Install Command | `bun install` / `npm install` (default) |
| Node.js Version | 20.x or later (Project → Settings → General) |

**Do not add any Environment Variables** — the app has none.

### 4. Deploy

1. Click **Deploy**.
2. Wait ~1–2 minutes: Vercel installs dependencies, runs `next build` and publishes.
3. You get a live URL like `https://qec-simulator.vercel.app` — open it and run a shot.

### 5. Redeploys are automatic

Every `git push` to `main` triggers a fresh production deployment automatically. Pull requests get their own preview URLs. Nothing to configure.

### 6. If something fails

- **Build error on Vercel but not locally** → check the Node version (use 20.x), and re-run `npm run build` locally first.
- **"Module not found"** → make sure you committed everything (`git status` must be clean) — especially `src/` and `package.json`.
- **Old content after a push** → Vercel redeploys automatically; hard-refresh the page (Ctrl/Cmd+Shift+R).
- **Custom domain** → Project → Settings → Domains → Add, then follow the DNS instructions Vercel shows.

---

## Project structure

```
qec-simulator/
├── all_with_noise_prob.py        # the reference program (Qiskit) — the scope source of truth
├── src/
│   ├── app/                      # Next.js App Router (single-page prototype)
│   ├── components/qec/
│   │   ├── Overview.tsx          # hero + objectives + compact worked example
│   │   ├── SimulatorLab.tsx      # single-shot pipeline + 11-row summary + exports
│   │   ├── QuantumLab3D.tsx      # 3D lab shell: Bloch Sphere + Flight 4D
│   │   ├── CircuitError3D.tsx    # 3D circuit & error propagation visualizer
│   │   ├── PerformanceLab.tsx    # Monte Carlo + sweeps + Code Showdown
│   │   ├── Learn.tsx / Galleries.tsx / Guide.tsx
│   │   ├── CircuitDiagram.tsx    # compact-large full-pipeline circuit renderer + PNG export
│   │   ├── BlochSphere.tsx / three-d.ts
│   ├── lib/qec/
│   │   ├── engine.ts             # state-vector simulator (gates, measurement, fidelity)
│   │   ├── codes.ts              # bit-flip, phase-flip + Shor codes + syndrome tables
│   │   ├── noise.ts              # the three channels (bitflip / phaseflip / depolarizing)
│   │   ├── circuit.ts            # full-pipeline circuit builder + layout + step descriptions
│   │   ├── pipeline.ts           # traces, Monte Carlo, sweeps, distributions, live rounds
│   │   └── registry.ts           # UI-facing code/noise registry
│   └── lib/report.ts             # PDF (with images + step logs) / JSON / CSV export helpers
├── scripts/
│   ├── test-qec.mjs              # 61-assertion core verification suite
│   ├── test-shor.mjs             # 8-assertion Shor-code suite (all 27 single-error cases)
│   └── test-propagation.mjs      # 17-assertion Clifford error-propagation suite
└── package.json
```
