# Quantum Error Correction Simulator (Flask + Qiskit)

Interactive website for simulating quantum noise and comparing three QEC codes:
3-qubit bit-flip, 3-qubit phase-flip and 9-qubit Shor. Every number on the
site comes from a real Qiskit Aer simulation.

## Run on Windows (VS Code terminal, PowerShell)

```powershell
cd path\to\quantum-qec-simulator
.\venv\Scripts\Activate.ps1        # your existing virtual environment (adjust the path)
pip install -r requirements.txt    # only needed if Flask is missing
python app.py
```

Open **http://127.0.0.1:5000** in your browser. Stop the server with Ctrl+C.
If PowerShell blocks the activate script, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Command-line version (your original program, now with Shor as option 3):

```powershell
python qec_simulator.py
```

Tests (stop nothing; the first needs no server, the second needs `python app.py` running):

```powershell
python tests\run_validation.py
python tests\test_api.py
```

## Files

| File | Purpose |
|---|---|
| `qec_simulator.py` | All Qiskit code: circuits, noise, analysis, sweep, CSV, validation, CLI |
| `app.py` | Flask routes (JSON API) |
| `templates/index.html` | Page |
| `static/css/style.css`, `static/js/app.js` | Styling and front-end logic |
| `static/js/chart.umd.js` | Chart.js 4.4.1, bundled so the site works offline |
| `output/` | CSV and PNG files saved by the site (created automatically) |
| `tests/` | Validation and API tests |

## Noise convention

"Noise probability" p is the **total** probability that a noisy qubit gets an error.

* Bit-flip: X with probability p. Phase-flip: Z with probability p.
* Depolarizing: X, Y, Z with probability p/3 each. Aer's `depolarizing_error(lam, 1)`
  uses `rho -> (1-lam) rho + lam I/2`, i.e. a total Pauli error probability of 3*lam/4,
  so the code passes `lam = 4p/3`. (The original script passed p directly, which gave a
  real error probability of only 0.75p.)
* Noise is attached to explicit `id` gates (shown as `I` in the circuit) and circuits
  are simulated without transpiling, so those gates cannot be optimised away.
* Only data qubits are noisy. Ancillas, syndrome extraction and recovery are noise-free.

## Logical basis

* **Z**: logical input |0> or |1>. **X**: logical input |+> or |->. Readout is in the same basis.
* A basis only reveals one kind of logical failure, so a bit-flip code looks perfect against
  Z noise in basis Z even though it does not protect phase. "Auto" picks the basis that
  matches the noise. Your original phase-flip circuit is the X-basis version.

## Changes made to the original code

1. `input()` prompts moved into `cli_main()` behind `if __name__ == "__main__"`.
2. Depolarizing parameter fixed (see above).
3. Phase-flip circuit generalised with a basis option (default X = your original circuit).
4. Optional noise on all data qubits; Shor code added; extra outputs (detected / corrected).
5. Syndrome table, bit ordering and corrections kept as in your code.

## Shor code layout

17 qubits: q0-q8 data (blocks 0-2, 3-5, 6-8), q9-q14 bit-flip ancillas (two per block),
q15-q16 phase-flip ancillas. Encoding: CX(0,3), CX(0,6), H on 0/3/6, then CX inside each block.
Syndrome: ZZ checks inside blocks (X errors), X^6 checks between blocks (Z errors).
Y = X and Z together, so both syndromes fire. Recovery uses one conditional per syndrome value.

## Limitations (also shown on the site)

* The 3-qubit codes correct one error of their own type; the Shor code corrects any
  single-qubit X, Y or Z, but not arbitrary multi-qubit errors. Independent noise on all
  nine qubits can create several errors, and Shor can then do worse than one bare qubit
  because it exposes nine noisy qubits instead of one. The comparison panel reports this honestly.
* Results are statistical: about +/-1 to 1.5 percentage points at 1000 shots.
* This is not a fault-tolerance simulation (ancilla/gate noise is not modelled).

## Deploy on Vercel (fixed build)

The first deploy attempt failed with *"No Next.js version detected. Make sure
your package.json has 'next'..."* because this project is a **Python (Flask +
Qiskit)** app, not a Node/Next.js project, and the Vercel project was running
the Next.js preset. The project now ships everything Vercel needs:

| Added file | Purpose |
|---|---|
| `vercel.json` | Forces the **Flask** framework preset (`"framework": "flask"`), overriding the Next.js preset that caused the error, and raises the function time limit to 60 s for long sweeps |
| `.python-version` | Pins Python 3.12 on Vercel (same as local) |
| `public/static/...` | Static assets served from Vercel's CDN (Vercel's official Flask guide says to use `public/**` for static files) |
| `.gitignore` | Keeps venvs, caches and generated `output/` files out of git |

`qec_simulator.py` has one small change: on Vercel the Function filesystem is
read-only except `/tmp`, so the CSV/PNG output folder automatically switches
to `/tmp/qec_output` (the `VERCEL=1` environment variable is set by Vercel).
Locally nothing changes — files still land in `output/`.

### Deploy from GitHub (recommended)

1. Push this project to GitHub. Keep `app.py`, `requirements.txt` and
   `vercel.json` in the **repository root** (or set
   *Settings → Build & Output → Root Directory* to the folder that contains
   them if you keep the `quantum-qec-simulator/` wrapper folder).
2. In Vercel: *Add New → Project → Import* the repository.
3. Framework Preset shows **Flask** (forced by `vercel.json`); leave all other
   settings as detected. No build command, no output directory needed.
4. Deploy. First build takes a few minutes (Qiskit + Aer are large wheels).

### Deploy with the Vercel CLI

```powershell
npm i -g vercel
cd path\to\quantum-qec-simulator
vercel          # preview deploy
vercel --prod   # production deploy
```

### Notes and limits

* Dependencies are ~300 MB installed (Qiskit + Aer + SciPy). This fits the
  standard Python function limit (500 MB uncompressed) and the 5 GB Fluid
  limit that new projects use by default. If an **older** Vercel project ever
  reports a function-size error, add the environment variable
  `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (*Settings → Environment Variables*) and
  redeploy.
* First request after inactivity has a cold start of a few seconds.
* `output/` on Vercel is per-instance and temporary: the *Download CSV/PNG*
  buttons work right after an experiment finishes, but saved files are not
  permanent storage. Download them when you see them, or run locally for
  permanent files.
* The QEC simulation logic, circuits, API and pages are unchanged.
