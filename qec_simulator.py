"""
qec_simulator.py
================
Quantum Error Correction simulator core (no Flask code in here).

Codes
-----
  bit_flip   : 3-qubit bit-flip repetition code
  phase_flip : 3-qubit phase-flip code
  shor       : 9-qubit Shor code (8 ancillas for syndrome extraction)

Noise convention (IMPORTANT)
----------------------------
"Noise probability" p always means: the TOTAL probability that the noisy
location suffers an error.

  bit-flip     : X with probability p, identity with 1-p
  phase-flip   : Z with probability p, identity with 1-p
  depolarizing : X, Y, Z with probability p/3 each, identity with 1-p.
                 In Qiskit Aer this is depolarizing_error(lambda, 1) with
                 lambda = 4p/3, because Aer's parameter lambda means
                 rho -> (1-lambda) rho + lambda * I/2, which gives a total
                 Pauli error probability of 3*lambda/4 (lambda/4 each).
                 (Your original code passed p directly as lambda, which
                  meant the real error probability was only 0.75*p.)

Noise is attached to explicit `id` gates placed in the circuit, and circuits
are simulated WITHOUT transpilation, so the noisy gates cannot be optimised
away.

Logical basis
-------------
  basis "Z": logical input is |b>        (b = 0 or 1)
  basis "X": logical input is |+> or |->  (b = 0 -> |+>, b = 1 -> |->)
The readout is in the same basis, so success = (output bit == input bit).
Your original phase-flip circuit is exactly the "X" basis version.
"""

import csv
import os
import re
import textwrap
from datetime import datetime
from pathlib import Path

from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, pauli_error, depolarizing_error

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CODE_INFO = {
    "bit_flip": {
        "name": "3-Qubit Bit-Flip QEC",
        "data_qubits": 3,
        "total_qubits": 5,
        "native_basis": "Z",
    },
    "phase_flip": {
        "name": "3-Qubit Phase-Flip QEC",
        "data_qubits": 3,
        "total_qubits": 5,
        "native_basis": "X",
    },
    "shor": {
        "name": "9-Qubit Shor QEC",
        "data_qubits": 9,
        "total_qubits": 17,
        "native_basis": "Z",
    },
}

NOISE_INFO = {
    "bit_flip": "Bit-Flip Noise (X)",
    "phase_flip": "Phase-Flip Noise (Z)",
    "depolarizing": "Depolarizing Noise",
}

# integer aliases used by the original command-line program
_NOISE_ALIAS = {1: "bit_flip", 2: "phase_flip", 3: "depolarizing"}
_CODE_ALIAS = {1: "bit_flip", 2: "phase_flip", 3: "shor"}

# Local: CSV/PNG files go to output/ next to this file (unchanged behaviour).
# Vercel: the Function filesystem is read-only except /tmp, so when the app
# detects the Vercel environment the output folder is placed there instead.
OUTPUT_DIR = (Path("/tmp/qec_output")
              if os.environ.get("VERCEL") == "1"
              else Path(__file__).resolve().parent / "output")

SYNDROME_TABLE_3Q = [
    ("00", "No error"),
    ("01", "q0 error"),
    ("11", "q1 error"),
    ("10", "q2 error"),
]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def normalize_noise(noise):
    return _NOISE_ALIAS.get(noise, noise)


def normalize_code(code):
    return _CODE_ALIAS.get(code, code)


def resolve_basis(code, noise, basis):
    """Resolve basis 'auto' to 'Z' or 'X'."""
    if basis in ("Z", "X"):
        return basis
    noise = normalize_noise(noise)
    if noise == "phase_flip":
        return "X"
    if noise == "bit_flip":
        return "Z"
    return CODE_INFO[code]["native_basis"]


def _targets(code, error_qubit, scope):
    n = CODE_INFO[code]["data_qubits"]
    if scope == "all":
        return list(range(n))
    return [int(error_qubit)]


def _noise_site(qc, qubits, forced_error):
    """Place the noise location. Normally an `id` gate that the noise model
    acts on. For deterministic tests a real Pauli gate is placed instead."""
    for q in qubits:
        if forced_error is None:
            qc.id(q)
        else:
            getattr(qc, forced_error.lower())(q)


def _prep(qc, input_bit, basis):
    if input_bit == 1:
        qc.x(0)
    if basis == "X":
        qc.h(0)


def _readout(qc, basis):
    if basis == "X":
        qc.h(0)


# ---------------------------------------------------------------------------
# 3-QUBIT BIT-FLIP QEC  (your original circuit, now with options)
# ---------------------------------------------------------------------------

def _three_qubit_syndrome_and_correction(qc):
    # q3 checks q0,q1   q4 checks q1,q2
    qc.cx(0, 3)
    qc.cx(1, 3)
    qc.cx(1, 4)
    qc.cx(2, 4)

    qc.measure(3, 0)
    qc.measure(4, 1)

    creg = qc.cregs[0]
    with qc.if_test((creg, 1)):   # 01 -> q0 error
        qc.x(0)
    with qc.if_test((creg, 3)):   # 11 -> q1 error
        qc.x(1)
    with qc.if_test((creg, 2)):   # 10 -> q2 error
        qc.x(2)


def bit_flip_qec(input_bit, error_qubit=0, noise_scope="selected",
                 basis="Z", forced_error=None):
    qc = QuantumCircuit(5, 3)
    _prep(qc, input_bit, basis)

    # encode
    qc.cx(0, 1)
    qc.cx(0, 2)

    # noise
    _noise_site(qc, _targets("bit_flip", error_qubit, noise_scope), forced_error)

    # syndrome + correction
    _three_qubit_syndrome_and_correction(qc)

    # decode
    qc.cx(0, 1)
    qc.cx(0, 2)

    _readout(qc, basis)
    qc.measure(0, 2)
    return qc


# ---------------------------------------------------------------------------
# 3-QUBIT PHASE-FLIP QEC
# ---------------------------------------------------------------------------

def phase_flip_qec(input_bit, error_qubit=0, noise_scope="selected",
                   basis="X", forced_error=None):
    qc = QuantumCircuit(5, 3)
    _prep(qc, input_bit, basis)

    # encode in the bit-flip code, then rotate to the Hadamard basis
    qc.cx(0, 1)
    qc.cx(0, 2)
    qc.h([0, 1, 2])

    # noise (on the phase-flip-encoded qubits)
    _noise_site(qc, _targets("phase_flip", error_qubit, noise_scope), forced_error)

    # rotate back: phase errors become bit flips
    qc.h([0, 1, 2])

    _three_qubit_syndrome_and_correction(qc)

    # decode
    qc.cx(0, 2)
    qc.cx(0, 1)

    _readout(qc, basis)
    qc.measure(0, 2)
    return qc


# ---------------------------------------------------------------------------
# 9-QUBIT SHOR CODE
# ---------------------------------------------------------------------------
#  Qubits 0..8   : data, three blocks (0,1,2) (3,4,5) (6,7,8)
#  Qubits 9..14  : bit-flip ancillas, block k uses 9+2k and 10+2k
#  Qubits 15,16  : phase-flip ancillas
#
#  Logical |0> = (|000>+|111>)(|000>+|111>)(|000>+|111>) / (2*sqrt2)
#  Logical |1> = (|000>-|111>)(|000>-|111>)(|000>-|111>) / (2*sqrt2)
#
#  Stabilizers measured:
#   inside each block : Z_a Z_b and Z_b Z_c       (find X errors)
#   between blocks    : X^6 on blocks 0,1  and  X^6 on blocks 1,2
#                                                  (find Z errors)
#  A Y error = X and Z together, so both syndrome types fire.

def shor_qec(input_bit, error_qubit=0, noise_scope="selected",
             basis="Z", forced_error=None):
    from qiskit import QuantumRegister, ClassicalRegister

    q = QuantumRegister(17, "q")
    bf = [ClassicalRegister(2, f"bf{k}") for k in range(3)]  # bit-flip syndromes
    pf = ClassicalRegister(2, "pf")                           # phase-flip syndrome
    out = ClassicalRegister(1, "out")                         # logical output
    qc = QuantumCircuit(q, *bf, pf, out)

    _prep(qc, input_bit, basis)

    # --- encoding ---------------------------------------------------------
    qc.cx(0, 3)
    qc.cx(0, 6)
    qc.h([0, 3, 6])
    for b in (0, 3, 6):
        qc.cx(b, b + 1)
        qc.cx(b, b + 2)

    # --- noise ------------------------------------------------------------
    _noise_site(qc, _targets("shor", error_qubit, noise_scope), forced_error)

    # --- bit-flip syndrome (Z-type checks inside each block) ---------------
    for k in range(3):
        b = 3 * k
        a1, a2 = 9 + 2 * k, 10 + 2 * k
        qc.cx(b, a1)
        qc.cx(b + 1, a1)
        qc.cx(b + 1, a2)
        qc.cx(b + 2, a2)

    # --- phase-flip syndrome (X-type checks between blocks) ----------------
    for anc, blocks in ((15, (0, 1)), (16, (1, 2))):
        qc.h(anc)
        for blk in blocks:
            for j in range(3):
                qc.cx(anc, 3 * blk + j)
        qc.h(anc)

    # --- measure syndromes --------------------------------------------------
    for k in range(3):
        qc.measure(9 + 2 * k, bf[k][0])
        qc.measure(10 + 2 * k, bf[k][1])
    qc.measure(15, pf[0])
    qc.measure(16, pf[1])

    # --- recovery -----------------------------------------------------------
    for k in range(3):                      # X corrections inside blocks
        b = 3 * k
        with qc.if_test((bf[k], 1)):        # 01 -> first qubit of block
            qc.x(b)
        with qc.if_test((bf[k], 3)):        # 11 -> middle qubit
            qc.x(b + 1)
        with qc.if_test((bf[k], 2)):        # 10 -> last qubit
            qc.x(b + 2)

    with qc.if_test((pf, 1)):               # 01 -> block 0 sign flipped
        qc.z(0)
    with qc.if_test((pf, 3)):               # 11 -> block 1
        qc.z(3)
    with qc.if_test((pf, 2)):               # 10 -> block 2
        qc.z(6)

    # --- decoding (exact inverse of the encoder) ----------------------------
    for b in (0, 3, 6):
        qc.cx(b, b + 2)
        qc.cx(b, b + 1)
    qc.h([0, 3, 6])
    qc.cx(0, 6)
    qc.cx(0, 3)

    _readout(qc, basis)
    qc.measure(0, out[0])
    return qc


def build_circuit(code, input_bit, error_qubit=0, noise_scope="selected",
                  basis="Z", forced_error=None):
    code = normalize_code(code)
    fn = {"bit_flip": bit_flip_qec, "phase_flip": phase_flip_qec,
          "shor": shor_qec}[code]
    return fn(input_bit, error_qubit, noise_scope, basis, forced_error)


def build_baseline(input_bit, basis="Z", forced_error=None):
    """Unprotected single qubit: same preparation, one noisy location, same
    readout. This is the 'Without QEC' reference."""
    qc = QuantumCircuit(1, 1)
    _prep(qc, input_bit, basis)
    _noise_site(qc, [0], forced_error)
    _readout(qc, basis)
    qc.measure(0, 0)
    return qc


def circuit_text(qc):
    """Qiskit's own ASCII drawing, unfolded (one long line per wire)."""
    return str(qc.draw(output="text", fold=-1))


# ---------------------------------------------------------------------------
# Noise model
# ---------------------------------------------------------------------------

def build_noise_model(noise_type, probability):
    noise_type = normalize_noise(noise_type)
    p = float(probability)
    nm = NoiseModel()
    if p <= 0:
        return nm  # noiseless

    if noise_type == "bit_flip":
        error = pauli_error([("X", p), ("I", 1 - p)])
    elif noise_type == "phase_flip":
        error = pauli_error([("Z", p), ("I", 1 - p)])
    elif noise_type == "depolarizing":
        lam = min(4.0 * p / 3.0, 4.0 / 3.0)
        error = depolarizing_error(lam, 1)
    else:
        raise ValueError(f"Unknown noise type: {noise_type}")

    nm.add_all_qubit_quantum_error(error, ["id"])
    return nm


# ---------------------------------------------------------------------------
# Running circuits
# ---------------------------------------------------------------------------

def run_circuit(qc, noise_model, shots, seed=None):
    """Run on AerSimulator. All circuits here contain only Clifford gates and
    Pauli noise, so the stabilizer method is exact and fast (also for 17
    qubits). If it is not supported, fall back to Aer's automatic method."""
    opts = {}
    if seed is not None:
        opts["seed_simulator"] = int(seed)
    try:
        sim = AerSimulator(noise_model=noise_model, method="stabilizer")
        return sim.run(qc, shots=shots, **opts).result().get_counts()
    except Exception:
        sim = AerSimulator(noise_model=noise_model)
        return sim.run(qc, shots=shots, **opts).result().get_counts()


# ---------------------------------------------------------------------------
# Result analysis
# ---------------------------------------------------------------------------

def _split_key(code, key):
    """Return (final_bit, syndrome_string) from a Qiskit counts key."""
    key = key.replace(" ", "")
    return key[0], key[1:]


def describe_syndrome(code, syn):
    """Human readable meaning of a syndrome string."""
    if code in ("bit_flip", "phase_flip"):
        return dict(SYNDROME_TABLE_3Q).get(syn, "?")
    # Shor: syn = pf(2) bf2(2) bf1(2) bf0(2)
    pf, bf2, bf1, bf0 = syn[0:2], syn[2:4], syn[4:6], syn[6:8]
    loc = {"01": 0, "11": 1, "10": 2}
    parts = []
    for k, s in enumerate((bf0, bf1, bf2)):
        if s in loc:
            parts.append(f"X on q{3 * k + loc[s]}")
    blk = {"01": 0, "11": 1, "10": 2}
    if pf in blk:
        parts.append(f"Z in block {blk[pf]}")
    return ", ".join(parts) if parts else "No error"


def _stats(successes, total):
    p = successes / total if total else 0.0
    se = (p * (1 - p) / total) ** 0.5 if total else 0.0
    return p * 100, se * 100


def analyze_counts(code, counts, input_bit):
    code = normalize_code(code)
    total = sum(counts.values())
    success = failed = 0
    detected = detected_ok = undetected_fail = 0
    logical = {"0": 0, "1": 0}
    syndromes = {}
    rows = []
    zero_syn = "0" * (2 if code != "shor" else 8)

    for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        final, syn = _split_key(code, key)
        ok = int(final) == input_bit
        logical[final] += n
        syndromes[syn] = syndromes.get(syn, 0) + n
        if ok:
            success += n
        else:
            failed += n
        if syn != zero_syn:
            detected += n
            if ok:
                detected_ok += n
        elif not ok:
            undetected_fail += n
        rows.append({"key": key, "final_bit": final, "syndrome": syn,
                     "meaning": describe_syndrome(code, syn),
                     "shots": n, "correct": ok})

    sr, se = _stats(success, total)
    return {
        "total_shots": total,
        "successful_shots": success,
        "failed_shots": failed,
        "success_rate": sr,
        "error_rate": 100 - sr,
        "success_rate_se": se,
        "logical_output": logical,
        "syndrome_distribution": syndromes,
        "syndrome_rows": rows,
        "detected_count": detected,
        "correction_success_count": detected_ok,
        "undetected_failure_count": undetected_fail,
        "detected_failure_count": detected - detected_ok,
    }


def analyze_baseline(counts, input_bit):
    total = sum(counts.values())
    ok = sum(n for k, n in counts.items() if int(k.replace(" ", "")[0]) == input_bit)
    sr, se = _stats(ok, total)
    return {"total_shots": total, "successful_shots": ok,
            "failed_shots": total - ok, "success_rate": sr,
            "error_rate": 100 - sr, "success_rate_se": se,
            "counts": counts}


# ---------------------------------------------------------------------------
# Compatibility messages
# ---------------------------------------------------------------------------

def compatibility(code, noise, scope, basis, probability):
    """Return (status, [messages]). status: MATCHED / PARTIAL / NOT MATCHED."""
    noise = normalize_noise(noise)
    msgs = []
    status = "MATCHED"

    if code == "bit_flip":
        if noise == "bit_flip":
            msgs.append("Bit-flip noise is being tested using the 3-qubit Bit-Flip QEC.")
        elif noise == "depolarizing":
            status = "PARTIAL"
            msgs.append("Depolarizing noise contains X, Y and Z errors. The bit-flip "
                        "code only corrects the X part, so it does NOT correct every "
                        "depolarizing error.")
        else:
            status = "NOT MATCHED"
            msgs.append("The bit-flip code cannot correct phase-flip (Z) errors.")
    elif code == "phase_flip":
        if noise == "phase_flip":
            msgs.append("Phase-flip noise is being tested using the 3-qubit Phase-Flip QEC.")
        elif noise == "depolarizing":
            status = "PARTIAL"
            msgs.append("Depolarizing noise contains X, Y and Z errors. The phase-flip "
                        "code only corrects the Z part, so it does NOT correct every "
                        "depolarizing error.")
        else:
            status = "NOT MATCHED"
            msgs.append("The phase-flip code cannot correct bit-flip (X) errors.")
    else:  # shor
        if scope == "all":
            status = "PARTIAL"
            msgs.append("Independent noise on all nine data qubits can create several "
                        "errors at once. The Shor code is only guaranteed to correct a "
                        "single-qubit Pauli error (X, Y or Z), not arbitrary multi-qubit errors.")
        else:
            msgs.append("The Shor code corrects any single-qubit Pauli error (X, Y or Z) "
                        "on one data qubit.")

    if code in ("bit_flip", "phase_flip") and scope == "all":
        msgs.append("Noise on all three data qubits can cause 2+ errors, which "
                    "a 3-qubit code cannot correct.")

    if code == "bit_flip" and basis == "X":
        msgs.append("Basis X: the bit-flip code does not protect phase information.")
    if code == "phase_flip" and basis == "Z":
        msgs.append("Basis Z: the phase-flip code does not protect against X errors "
                    "on logical |0>/|1> in the conjugate basis; use basis X to see "
                    "its natural behaviour.")
    if noise == "phase_flip" and basis == "Z" and code != "phase_flip":
        msgs.append("Z errors do not change a computational-basis (Z) readout, so "
                    "this experiment cannot show them. Choose basis X or Auto.")
    if noise == "bit_flip" and basis == "X":
        msgs.append("X errors do not change an X-basis readout of |+>/|-> on a bare "
                    "qubit; the baseline will look perfect.")
    if noise == "depolarizing":
        msgs.append("A single readout basis only reveals one kind of logical failure "
                    "(basis Z shows logical bit flips, basis X shows logical phase flips). "
                    "Run both bases for the full picture.")
    return status, msgs


# ---------------------------------------------------------------------------
# One full experiment
# ---------------------------------------------------------------------------

EXPLANATIONS = {
    "bit_flip": "Encodes one logical bit into 3 qubits (|0>->|000>, |1>->|111>), "
                "measures two parity checks (q0q1 and q1q2) with ancillas q3 and q4 and "
                "flips back the qubit the syndrome points at. Corrects one X error.",
    "phase_flip": "Same repetition structure in the Hadamard basis. Parity checks detect "
                  "which qubit got a Z error and the correction repairs it. Corrects one Z error.",
    "shor": "Concatenates the phase-flip and bit-flip codes over 9 data qubits with 8 "
            "ancillas. Three ZZ checks per block locate X errors, two X^6 checks between "
            "blocks locate Z errors. Corrects any single-qubit X, Y or Z error.",
}


def run_experiment(code, input_bit, noise, probability, shots=1000,
                   error_qubit=0, noise_scope="selected", basis="auto",
                   seed=None, with_circuit=True, with_baseline=True):
    code = normalize_code(code)
    noise = normalize_noise(noise)
    basis = resolve_basis(code, noise, basis)

    qc = build_circuit(code, input_bit, error_qubit, noise_scope, basis)
    nm = build_noise_model(noise, probability)
    counts = run_circuit(qc, nm, shots, seed)
    res = analyze_counts(code, counts, input_bit)

    n_sites = len(_targets(code, error_qubit, noise_scope))
    status, msgs = compatibility(code, noise, noise_scope, basis, probability)

    result = {
        "config": {
            "code": code, "code_name": CODE_INFO[code]["name"],
            "input_bit": input_bit, "noise": noise,
            "noise_name": NOISE_INFO[noise], "probability": probability,
            "shots": shots, "error_qubit": int(error_qubit),
            "noise_scope": noise_scope, "basis": basis,
            "data_qubits": CODE_INFO[code]["data_qubits"],
            "total_qubits": CODE_INFO[code]["total_qubits"],
            "noisy_locations": n_sites,
        },
        "counts": counts,
        "qec": res,
        "status": status,
        "messages": msgs,
        "explanation": EXPLANATIONS[code],
    }

    if with_baseline:
        bqc = build_baseline(input_bit, basis)
        bcounts = run_circuit(bqc, nm, shots, None if seed is None else seed + 1)
        base = analyze_baseline(bcounts, input_bit)
        result["baseline"] = base
        result["improvement"] = res["success_rate"] - base["success_rate"]
        result["comparison_note"] = (
            "Without QEC: one bare qubit with one noisy location (probability p). "
            f"With QEC: {n_sites} noisy location(s) on the data qubits, each with "
            "probability p. Ancilla qubits and syndrome/recovery gates are "
            "noise-free in this model, so the comparison measures how well the code "
            "handles errors on the data qubits only."
        )

    if with_circuit:
        result["circuit"] = circuit_text(qc)
        result["circuit_stats"] = {"qubits": qc.num_qubits, "clbits": qc.num_clbits,
                                   "depth": qc.depth(), "size": qc.size()}

    result["report"] = format_report(result)
    return result


# ---------------------------------------------------------------------------
# Text report in the same style as the original terminal program
# ---------------------------------------------------------------------------

def _hdr(title):
    return ["=" * 42, title.center(42).rstrip(), "=" * 42]


def format_report(result, include_circuit=False):
    c = result["config"]
    r = result["qec"]
    L = []
    L += _hdr("SELECTION")
    L.append(f"Input bit        : {c['input_bit']}")
    L.append(f"Noise model      : {c['noise_name']}")
    L.append(f"Noise probability: {c['probability']}")
    L.append(f"QEC code         : {c['code_name']}")
    if c["noise_scope"] == "all":
        L.append(f"Noise scope      : all {c['data_qubits']} data qubits (independent)")
    else:
        L.append(f"Error qubit      : {c['error_qubit']}")
    L.append(f"Logical basis    : {c['basis']}")
    L.append(f"Shots            : {c['shots']}")
    L.append("")
    L.append(f"QEC STATUS       : {result['status']}")
    for m in result["messages"]:
        L.append(textwrap.fill(m, width=72, initial_indent="  - ", subsequent_indent="    "))
    L.append("")
    L += _hdr("SIMULATION")
    L.append(f"Measurement results: {result['counts']}")
    L.append("")
    L += _hdr("INTERPRETATION")
    for row in r["syndrome_rows"]:
        mark = "OK  " if row["correct"] else "FAIL"
        L.append(f"{row['key']} -> Final bit = {row['final_bit']}, "
                 f"Syndrome = {row['syndrome']} ({row['meaning']}), "
                 f"Shots = {row['shots']}  [{mark}]")
    L.append("")
    L += _hdr("PERFORMANCE ANALYSIS")
    L.append(f"Total shots      : {r['total_shots']}")
    L.append(f"Successful shots : {r['successful_shots']}")
    L.append(f"Failed shots     : {r['failed_shots']}")
    L.append(f"Success rate     : {r['success_rate']:.2f}%  (+/- {r['success_rate_se']:.2f} std. error)")
    L.append(f"Error rate       : {r['error_rate']:.2f}%")
    L.append("")
    L.append(f"Syndrome detected shots        : {r['detected_count']}")
    L.append(f"  detected and corrected OK    : {r['correction_success_count']}")
    L.append(f"  detected but still failed    : {r['detected_failure_count']}")
    L.append(f"Undetected logical failures    : {r['undetected_failure_count']}")
    L.append("")
    L.append(f"Expected original input bit: {c['input_bit']}")
    L.append(f"Expected final bit         : {c['input_bit']}")

    if "baseline" in result:
        b = result["baseline"]
        L.append("")
        L += _hdr("WITHOUT QEC vs WITH QEC")
        L.append(f"Without QEC success rate : {b['success_rate']:.2f}%   error {b['error_rate']:.2f}%")
        L.append(f"With QEC success rate    : {r['success_rate']:.2f}%   error {r['error_rate']:.2f}%")
        L.append(f"Improvement              : {result['improvement']:+.2f} percentage points")

    L.append("")
    L.append("Syndrome Table:")
    if c["code"] == "shor":
        L.append("Order of the 8 syndrome bits: pf bf2 bf1 bf0 (each 2 bits)")
        L.append("bf_k (block k, bit-flip) : 00 none, 01 first, 11 middle, 10 last qubit")
        L.append("pf (phase-flip)          : 00 none, 01 block0, 11 block1, 10 block2")
    else:
        for s, m in SYNDROME_TABLE_3Q:
            L.append(f"{s} -> {m}")

    if include_circuit and "circuit" in result:
        L.append("")
        L += _hdr("CIRCUIT")
        L.append(result["circuit"])
    return "\n".join(L)


# ---------------------------------------------------------------------------
# Automatic sweep + CSV export
# ---------------------------------------------------------------------------

def probability_list(step_percent):
    step = float(step_percent)
    if step <= 0 or step > 100:
        raise ValueError("Step must be between 0 and 100 percent.")
    vals, x = [], 0.0
    while x < 100 - 1e-9:
        vals.append(round(x, 6))
        x += step
    vals.append(100.0)
    return [v / 100 for v in vals]


def run_sweep(code, input_bit, noise, shots, error_qubit, noise_scope, basis,
              step_percent=10, seed=None):
    code = normalize_code(code)
    noise = normalize_noise(noise)
    basis = resolve_basis(code, noise, basis)
    rows = []
    for i, p in enumerate(probability_list(step_percent)):
        s = None if seed is None else seed + 10 * i
        res = run_experiment(code, input_bit, noise, p, shots, error_qubit,
                             noise_scope, basis, seed=s,
                             with_circuit=False, with_baseline=True)
        rows.append({
            "probability_percent": round(p * 100, 4),
            "without_qec_success": res["baseline"]["success_rate"],
            "with_qec_success": res["qec"]["success_rate"],
            "without_qec_error": res["baseline"]["error_rate"],
            "with_qec_error": res["qec"]["error_rate"],
            "improvement": res["improvement"],
            "qec_code": CODE_INFO[code]["name"],
            "noise_model": NOISE_INFO[noise],
            "noise_scope": noise_scope,
            "basis": basis,
            "shots": shots,
        })
    return rows


CSV_FIELDS = [
    ("probability_percent", "Noise probability (%)"),
    ("without_qec_success", "Without-QEC success rate (%)"),
    ("with_qec_success", "With-QEC success rate (%)"),
    ("without_qec_error", "Without-QEC error rate (%)"),
    ("with_qec_error", "With-QEC error rate (%)"),
    ("improvement", "Improvement (percentage points)"),
    ("qec_code", "QEC code"),
    ("noise_model", "Noise model"),
    ("noise_scope", "Noise scope"),
    ("basis", "Logical basis"),
    ("shots", "Shots"),
]


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def ensure_output_dir():
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise OSError(f"Cannot create output folder {OUTPUT_DIR}: {e}")
    return OUTPUT_DIR


def save_csv(rows):
    """Write rows to output/ and verify the file exists. Returns file name."""
    if not rows:
        raise ValueError("No results to save.")
    out = ensure_output_dir()
    first = rows[0]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = (f"qec_results_{_slug(first['qec_code'])}_{_slug(first['noise_model'])}"
            f"_{first['noise_scope']}_{stamp}.csv")
    path = out / name
    try:
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow([h for _, h in CSV_FIELDS])
            for r in rows:
                w.writerow([r[k] if not isinstance(r[k], float) else round(r[k], 4)
                            for k, _ in CSV_FIELDS])
    except PermissionError:
        raise PermissionError(f"Permission denied writing {path}. Close the file if it "
                              "is open in Excel, or check folder permissions.")
    if not path.exists() or path.stat().st_size == 0:
        raise OSError("CSV was not created.")
    return name


def save_png_bytes(data, label="qec_graph"):
    out = ensure_output_dir()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = f"{_slug(label)}_{stamp}.png"
    path = out / name
    try:
        with open(path, "wb") as f:
            f.write(data)
    except PermissionError:
        raise PermissionError(f"Permission denied writing {path}.")
    if not path.exists() or path.stat().st_size == 0:
        raise OSError("PNG was not created.")
    return name


# ---------------------------------------------------------------------------
# Validation suite (real simulations, deterministic)
# ---------------------------------------------------------------------------

# Expected logical-readout success for ONE forced Pauli error, by code & basis.
# (A 3-qubit code cannot fix the 'other' Pauli once the readout basis is
#  conjugate to the protected one; Shor fixes everything.)
EXPECTED_SINGLE_ERROR = {
    ("bit_flip", "Z"): {"X": True, "Y": True, "Z": True},
    ("bit_flip", "X"): {"X": True, "Y": False, "Z": False},
    ("phase_flip", "Z"): {"X": True, "Y": True, "Z": True},
    ("phase_flip", "X"): {"X": False, "Y": False, "Z": True},
    ("shor", "Z"): {"X": True, "Y": True, "Z": True},
    ("shor", "X"): {"X": True, "Y": True, "Z": True},
}


def run_validation(code, shots=50):
    """Noise-free and forced single-error tests. Returns list of test rows."""
    code = normalize_code(code)
    n = CODE_INFO[code]["data_qubits"]
    nm = NoiseModel()
    tests = []

    def run(inp, basis, qubit=0, err=None):
        qc = build_circuit(code, inp, qubit, "selected", basis, forced_error=err)
        counts = run_circuit(qc, nm, shots)
        return analyze_counts(code, counts, inp)["successful_shots"] == shots

    for basis in ("Z", "X"):
        ok = all(run(b, basis) for b in (0, 1))
        tests.append({"test": f"Noise-free, inputs 0 and 1, basis {basis}",
                      "expected": "recovered", "observed": "recovered" if ok else "FAILED",
                      "passed": ok})

    for basis in ("Z", "X"):
        for err in ("X", "Y", "Z"):
            expect = EXPECTED_SINGLE_ERROR[(code, basis)][err]
            got = all(run(b, basis, q, err) for b in (0, 1) for q in range(n))
            tests.append({
                "test": f"Forced {err} error on each of {n} data qubits, basis {basis}",
                "expected": "recovered" if expect else "not recovered (code limitation)",
                "observed": "recovered" if got else "not recovered",
                "passed": got == expect})
    return tests


# ---------------------------------------------------------------------------
# Command-line interface (same prompts as the original program)
# ---------------------------------------------------------------------------

def cli_main():
    print("=" * 42)
    print("       QUANTUM ERROR CORRECTION")
    print("             SIMULATOR")
    print("=" * 42)

    def ask(prompt, cast, valid=None):
        v = cast(input(prompt))
        if valid is not None and v not in valid:
            print("Invalid input.")
            raise SystemExit
        return v

    input_bit = ask("\nEnter input bit (0 or 1): ", int, [0, 1])
    print("\nSelect Noise Model:\n1. Bit-Flip Noise (X)\n2. Phase-Flip Noise (Z)\n3. Depolarizing Noise")
    noise = ask("Enter noise choice (1, 2 or 3): ", int, [1, 2, 3])
    p = ask("\nProbability (0 to 1): ", float)
    if not 0 <= p <= 1:
        print("Probability must be between 0 and 1.")
        raise SystemExit
    print("\nSelect QEC Code:\n1. 3-Qubit Bit-Flip QEC\n2. 3-Qubit Phase-Flip QEC\n3. 9-Qubit Shor QEC")
    code = ask("Enter QEC choice (1, 2 or 3): ", int, [1, 2, 3])
    n = 9 if code == 3 else 3
    qb = input(f"\nEnter error qubit (0-{n - 1}, or 'all'): ").strip()
    scope = "all" if qb.lower() == "all" else "selected"
    qb = 0 if scope == "all" else int(qb)
    if scope == "selected" and not 0 <= qb < n:
        print("Invalid error qubit.")
        raise SystemExit

    res = run_experiment(code, input_bit, noise, p, 1000, qb, scope, "auto")
    print()
    print(format_report(res, include_circuit=True))


if __name__ == "__main__":
    cli_main()
