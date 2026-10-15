"""
Deterministic validation of all three QEC codes.
Run from the project folder:   python tests/run_validation.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qiskit.circuit import CircuitInstruction
from qiskit.circuit.library import XGate, ZGate
from qiskit_aer.noise import NoiseModel
import qec_simulator as S

allok = True


def report(passed, text):
    global allok
    allok &= passed
    print(f"[{'PASS' if passed else 'FAIL'}] {text}")


for code in ("bit_flip", "phase_flip", "shor"):
    print(f"\n=== {S.CODE_INFO[code]['name']} ===")
    for t in S.run_validation(code):
        report(t["passed"], f"{t['test']:<58} expected: {t['expected']:<36} observed: {t['observed']}")


def two_errors(gate, qa, qb, basis):
    qc = S.build_circuit("shor", 0, 0, "selected", basis, None)
    i = [k for k, ins in enumerate(qc.data) if ins.operation.name == "id"][0]
    qc.data[i] = qc.data[i].replace(operation=gate(), qubits=(qc.qubits[qa],))
    qc.data.insert(i, CircuitInstruction(gate(), (qc.qubits[qb],)))
    counts = S.run_circuit(qc, NoiseModel(), 200)
    return S.analyze_counts("shor", counts, 0)["success_rate"]


print("\n=== Shor code: known limits (two errors) ===")
report(two_errors(ZGate, 0, 3, "Z") == 0.0, "Z on q0 and q3 (different blocks) -> logical X, basis Z -> must FAIL")
report(two_errors(XGate, 0, 1, "X") == 0.0, "X on q0 and q1 (same block)       -> logical Z, basis X -> must FAIL")
report(two_errors(ZGate, 0, 1, "X") == 100.0, "Z on q0 and q1 (same block) equals one block-Z -> corrected")
report(two_errors(XGate, 0, 3, "Z") == 100.0, "X on q0 and q3 (different blocks) -> two single-block flips, corrected")

print("\n=== Noise really applied (statistical) ===")
r = S.run_experiment("bit_flip", 1, "bit_flip", 0.2, 4000, 1, "selected", "auto", seed=7)
report(abs(r["baseline"]["success_rate"] - 80) < 3, f"baseline success ~80% at p=0.2 (got {r['baseline']['success_rate']:.1f}%)")
report(r["qec"]["success_rate"] == 100.0, "bit-flip QEC fixes a single noisy qubit: 100%")
r = S.run_experiment("bit_flip", 1, "bit_flip", 0.2, 4000, 1, "all", "auto", seed=7)
report(abs(r["qec"]["success_rate"] - 89.6) < 3, f"all 3 qubits noisy: ~89.6% theory (got {r['qec']['success_rate']:.1f}%)")

print("\n=== Sweep + file export ===")
rows = S.run_sweep("shor", 0, "depolarizing", 200, 0, "selected", "Z", 25, seed=1)
report(len(rows) == 5, f"sweep produced {len(rows)} points (0,25,50,75,100)")
name = S.save_csv(rows)
report((S.OUTPUT_DIR / name).exists(), f"CSV written: output/{name}")
import struct, zlib
png = (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
       + struct.pack(">I", zlib.crc32(b"IHDR" + struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))))
pname = S.save_png_bytes(png, "test_graph")
report((S.OUTPUT_DIR / pname).exists(), f"PNG written: output/{pname}")
(S.OUTPUT_DIR / name).unlink(); (S.OUTPUT_DIR / pname).unlink()

print("\nALL VALIDATION TESTS PASSED" if allok else "\nSOME TESTS FAILED")
sys.exit(0 if allok else 1)
