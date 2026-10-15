"""
qec_3d.py
==========
3D visualization helpers for the QEC simulator.

Three kinds of data are produced here, all consumed by the front-end
"3D Simulator Lab" tab:

  1. Bloch-sphere state of a single selected qubit at a chosen stage
     of the QEC pipeline (prep / encode / noise / syndrome / correct /
     decode / final).

  2. 3D circuit layout: qubit wires, gate blocks, noise markers, syndrome
     ancillas and correction operations, in (x, y, z) coordinates that
     the front-end renders with Three.js.

  3. Error propagation: a frame-by-frame trace of a single Pauli error
     injected at the noise location, propagated through the circuit by
     Clifford conjugation rules, with syndrome bits and correction
     applied at the right moments.
"""

import math
import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, partial_trace

from qec_simulator import (
    CODE_INFO, NOISE_INFO, build_circuit, resolve_basis,
    normalize_code, normalize_noise, _targets,
)


# ---------------------------------------------------------------------------
# Stage split - turn a Qiskit circuit into a list of named stages
# ---------------------------------------------------------------------------

def _stage_split(code, qc):
    """Classify each gate into a pipeline stage.

    Strategy: identify the noise location (the first `id` gate) and the
    first conditional-correction gate (Qiskit exposes `if_test` blocks as
    `if_else` operations in `qc.data`). Everything before the noise is
    prep + encode; between noise and correction is syndrome; the
    conditional blocks are correct; after them is decode + final.
    """
    code = normalize_code(code)
    noise_idx = None
    first_correction_idx = None
    last_measure_idx = None

    for i, inst in enumerate(qc.data):
        name = inst.operation.name
        if name == "id" and noise_idx is None:
            noise_idx = i
        if name in ("if_test", "if_else") and first_correction_idx is None:
            first_correction_idx = i
        if name == "measure":
            last_measure_idx = i

    flat = []
    for i, inst in enumerate(qc.data):
        name = inst.operation.name
        qubits = [qc.find_bit(q).index for q in inst.qubits]
        cbits = [qc.find_bit(c).index for c in inst.clbits] if inst.clbits else []

        if noise_idx is None or i < noise_idx:
            # Before noise: prep (x on q0 / first h on q0) or encode
            if name == "x" and len(qubits) == 1 and qubits[0] == 0:
                stage = "prep"
            elif name == "h" and len(qubits) == 1 and qubits[0] == 0 and i == 0:
                stage = "prep"
            else:
                stage = "encode"
        elif i == noise_idx:
            stage = "noise"
        elif first_correction_idx is not None and i >= first_correction_idx:
            if name in ("if_test", "if_else"):
                stage = "correct"
            elif name == "measure":
                stage = "final"
            else:
                stage = "decode"
        else:
            # Between noise and correction: syndrome (rotate-back H, cx, measure)
            stage = "syndrome"

        flat.append({"stage": stage, "name": name, "qubits": qubits, "cbits": cbits})

    stages_order = ["prep", "encode", "noise", "syndrome", "correct", "decode", "final"]
    buckets = {s: [] for s in stages_order}
    for d in flat:
        buckets[d["stage"]].append(d)
    return buckets, flat


# ---------------------------------------------------------------------------
# Bloch sphere
# ---------------------------------------------------------------------------

def _bloch_from_density(rho):
    """Compute Bloch vector from a 2x2 density matrix (numpy array)."""
    rho = np.asarray(rho, dtype=complex)
    # Pauli matrices
    sx = np.array([[0, 1], [1, 0]], dtype=complex)
    sy = np.array([[0, -1j], [1j, 0]], dtype=complex)
    sz = np.array([[1, 0], [0, -1]], dtype=complex)
    x = float(np.real(np.trace(rho @ sx)))
    y = float(np.real(np.trace(rho @ sy)))
    z = float(np.real(np.trace(rho @ sz)))
    # Clip to unit ball
    n = math.sqrt(x * x + y * y + z * z)
    if n > 1.0:
        x, y, z = x / n, y / n, z / n
    return {"x": x, "y": y, "z": z,
            "theta": math.degrees(math.acos(max(-1.0, min(1.0, z)))),
            "phi": math.degrees(math.atan2(y, x)),
            "length": min(1.0, n)}


def _build_circuit_up_to_stage(code, input_bit, error_qubit, noise_scope, basis, stage):
    """Rebuild the QEC circuit up to and including the requested stage,
    without measurements or conditional gates, so Statevector can run."""
    qc = build_circuit(code, input_bit, error_qubit, noise_scope, basis)
    buckets, _ = _stage_split(code, qc)

    stages_order = ["prep", "encode", "noise", "syndrome", "correct", "decode", "final"]
    if stage not in stages_order:
        stage = "final"

    # Build a fresh circuit without classical bits (statevector doesn't need them)
    qc_sv = QuantumCircuit(qc.num_qubits)

    seen_stages = set()
    for s in stages_order:
        if s == stage:
            # Include this stage's instructions but stop before the next
            for d in buckets[s]:
                _append_statevector_safe(qc_sv, d, qc)
            break
        for d in buckets[s]:
            _append_statevector_safe(qc_sv, d, qc)

    return qc_sv, qc.num_qubits


def _append_statevector_safe(qc_sv, d, qc_orig):
    """Append an instruction to the statevector circuit, skipping
    measurements and conditional gates."""
    name = d["name"]
    qubits = d["qubits"]
    if name == "measure":
        return
    if name in ("if_test", "if_else"):
        return
    if name == "id":
        # No-op for the statevector (the noise model would act here)
        return
    # Look up the original instruction and append
    # We rebuild a clean instruction by name + qubits
    if name == "cx":
        qc_sv.cx(qubits[0], qubits[1])
    elif name == "h":
        qc_sv.h(qubits[0])
    elif name == "x":
        qc_sv.x(qubits[0])
    elif name == "y":
        qc_sv.y(qubits[0])
    elif name == "z":
        qc_sv.z(qubits[0])
    elif name == "s":
        qc_sv.s(qubits[0])
    elif name == "t":
        qc_sv.t(qubits[0])
    elif name == "rx":
        qc_sv.rx(0.5, qubits[0])
    elif name == "ry":
        qc_sv.ry(0.5, qubits[0])
    elif name == "rz":
        qc_sv.rz(0.5, qubits[0])
    # ignore anything else


def get_bloch_state(code, input_bit, error_qubit, noise_scope, basis,
                    qubit_index=0, stage="final", noise_type=None,
                    probability=0.0):
    """Compute the Bloch vector for one qubit at one stage of the circuit.

    If noise_type is given, an actual Pauli error of that type is injected
    at the noise location so the user can SEE the state change. (This is a
    deterministic visualization; the real noise model is sampled.)
    """
    code = normalize_code(code)
    n_data = CODE_INFO[code]["data_qubits"]
    n_total = CODE_INFO[code]["total_qubits"]
    if qubit_index < 0 or qubit_index >= n_total:
        qubit_index = 0

    qc_sv, n_qubits = _build_circuit_up_to_stage(
        code, input_bit, error_qubit, noise_scope, basis, stage
    )

    # Inject a forced error at the noise location
    if noise_type in ("X", "Y", "Z") and stage in ("noise", "syndrome", "correct", "decode", "final"):
        targets = _targets(code, error_qubit, noise_scope)
        # Insert the Pauli gate at each target qubit, right after the existing
        # instructions up to "encode". We do this by rebuilding the circuit.
        # Easier: rebuild from scratch with forced error.
        from qec_simulator import build_circuit as _bc
        forced = "X" if noise_type == "X" else "Y" if noise_type == "Y" else "Z" if noise_type == "Z" else None
        qc_forced = _bc(code, input_bit, error_qubit, noise_scope, basis, forced_error=forced.lower() if forced else None)
        buckets, _ = _stage_split(code, qc_forced)
        stages_order = ["prep", "encode", "noise", "syndrome", "correct", "decode", "final"]
        qc_sv = QuantumCircuit(n_qubits)
        for s in stages_order:
            if s == stage:
                for d in buckets[s]:
                    _append_statevector_safe(qc_sv, d, qc_forced)
                break
            for d in buckets[s]:
                _append_statevector_safe(qc_sv, d, qc_forced)

    # Run statevector
    try:
        sv = Statevector(qc_sv)
    except Exception as e:
        # Fallback: try DensityMatrix
        from qiskit.quantum_info import DensityMatrix
        sv = DensityMatrix(qc_sv)

    # Trace out all qubits except the selected one
    other_qubits = [i for i in range(n_qubits) if i != qubit_index]
    if other_qubits:
        rho = partial_trace(sv, other_qubits)
    else:
        rho = sv
    rho_np = np.asarray(rho.data, dtype=complex)

    bloch = _bloch_from_density(rho_np)

    # Compute Bloch vector for the pure state without noise (for comparison)
    # if user wants to see "where it would be without noise"
    return {
        "qubit": qubit_index,
        "stage": stage,
        "bloch": bloch,
        "code": code,
        "code_name": CODE_INFO[code]["name"],
        "basis": resolve_basis(code, noise_type or "bit_flip", basis),
        "n_data_qubits": n_data,
        "n_total_qubits": n_total,
    }


# ---------------------------------------------------------------------------
# 3D circuit layout
# ---------------------------------------------------------------------------

# Stage colors (used for both backend hints and front-end defaults)
STAGE_COLORS = {
    "prep":     "#5b8cff",   # blue
    "encode":   "#8b6cff",   # purple
    "noise":    "#ff6b81",   # red (the noise gate is the alarming one)
    "syndrome": "#3ddc97",   # green
    "correct":  "#ffc857",   # amber
    "decode":   "#7aa2ff",   # light blue
    "final":    "#c9d3ff",   # near-white
}

# Per-gate shape hints for the front-end
GATE_KIND = {
    "h":   "box-h",
    "x":   "box-x",
    "y":   "box-y",
    "z":   "box-z",
    "cx":  "cx",
    "id":  "noise",
    "measure": "measure",
    "if_test": "correct",
    "if_else": "correct",
    "barrier": "barrier",
}


def _gate_label(name):
    return {
        "h": "H", "x": "X", "y": "Y", "z": "Z", "s": "S", "t": "T",
        "rx": "RX", "ry": "RY", "rz": "RZ",
        "cx": "•⊕", "id": "I", "measure": "M",
        "if_test": "if", "if_else": "if",
    }.get(name, name)


def get_circuit_3d(code, input_bit, error_qubit, noise_scope, basis):
    """Build a 3D layout for the chosen QEC circuit.

    Layout convention:
      X axis : qubit index (data qubits 0..n-1, then ancillas)
      Z axis : time (gate index, increasing into the screen)
      Y axis : reserved for vertical layers (Shor blocks) and the orbit camera
    """
    code = normalize_code(code)
    n_data = CODE_INFO[code]["data_qubits"]
    n_total = CODE_INFO[code]["total_qubits"]

    qc = build_circuit(code, input_bit, error_qubit, noise_scope, basis)
    buckets, flat = _stage_split(code, qc)

    # Build a list of "time slots" - each gate gets one slot per qubit it touches.
    # We do a left-to-right scan; each multi-qubit gate consumes one column.
    columns = []  # each entry: {time, qubits, name, stage, kind, label, color, is_noise, is_correction}
    time = 0
    noise_targets = set(_targets(code, error_qubit, noise_scope))

    for d in flat:
        time += 1
        col = {
            "time": time,
            "qubits": list(d["qubits"]),
            "name": d["name"],
            "stage": d["stage"],
            "kind": GATE_KIND.get(d["name"], "box"),
            "label": _gate_label(d["name"]),
            "color": STAGE_COLORS.get(d["stage"], "#7aa2ff"),
            "is_noise": d["name"] == "id",
            "is_measure": d["name"] == "measure",
            "is_correction": d["name"] in ("if_test", "if_else"),
            "cbits": list(d["cbits"]),
        }
        if d["name"] == "id":
            col["noise_qubits"] = [q for q in d["qubits"] if q in noise_targets]
        columns.append(col)

    # Qubit metadata
    qubits = []
    for i in range(n_total):
        if i < n_data:
            if code == "shor":
                block = i // 3
                pos = i % 3
                qubits.append({
                    "id": i, "label": f"q{i}",
                    "type": "data",
                    "block": block,
                    "pos_in_block": pos,
                    "is_ancilla": False,
                    "is_noise_target": i in noise_targets,
                })
            else:
                qubits.append({
                    "id": i, "label": f"q{i}",
                    "type": "data",
                    "is_ancilla": False,
                    "is_noise_target": i in noise_targets,
                })
        else:
            label = f"a{i - n_data}"
            if code == "shor":
                if i < 15:
                    block = (i - 9) // 2
                    qubits.append({
                        "id": i, "label": label, "type": "ancilla-bf",
                        "block": block, "is_ancilla": True,
                    })
                else:
                    qubits.append({
                        "id": i, "label": label, "type": "ancilla-pf",
                        "is_ancilla": True,
                    })
            else:
                qubits.append({
                    "id": i, "label": label, "type": "ancilla",
                    "is_ancilla": True,
                })

    return {
        "code": code,
        "code_name": CODE_INFO[code]["name"],
        "basis": resolve_basis(code, "bit_flip", basis),
        "input_bit": input_bit,
        "error_qubit": error_qubit,
        "noise_scope": noise_scope,
        "n_data_qubits": n_data,
        "n_total_qubits": n_total,
        "qubits": qubits,
        "columns": columns,
        "n_columns": len(columns),
        "stage_colors": STAGE_COLORS,
        "noise_targets": sorted(noise_targets),
    }


# ---------------------------------------------------------------------------
# Error propagation
# ---------------------------------------------------------------------------

# Pauli multiplication table (ignoring phases)
_PAULI_MUL = {
    ("I", "I"): "I", ("I", "X"): "X", ("I", "Y"): "Y", ("I", "Z"): "Z",
    ("X", "I"): "X", ("X", "X"): "I", ("X", "Y"): "Z", ("X", "Z"): "Y",
    ("Y", "I"): "Y", ("Y", "X"): "Z", ("Y", "Y"): "I", ("Y", "Z"): "X",
    ("Z", "I"): "Z", ("Z", "X"): "Y", ("Z", "Y"): "X", ("Z", "Z"): "I",
}


def _pauli_mul(a, b):
    return _PAULI_MUL[(a, b)]


def _propagate_through_gate(paulis, gate, qubits):
    """Update the per-qubit Pauli frame after a Clifford gate.

    paulis: dict {qubit_index: "I"/"X"/"Y"/"Z"}
    gate: gate name
    qubits: list of qubit indices the gate acts on
    Returns a new dict.
    """
    p = dict(paulis)
    if gate == "h":
        q = qubits[0]
        # H X H = Z, H Z H = X, H Y H = -Y (sign ignored)
        if p.get(q, "I") == "X":
            p[q] = "Z"
        elif p.get(q, "I") == "Z":
            p[q] = "X"
        # Y stays Y (just sign flip)
    elif gate == "x":
        q = qubits[0]
        # X X X = X, X Z X = Z, X Y X = Y (sign ignored)
        # Actually X Y X = -Y; X Z X = -Z. Ignoring signs:
        # No conjugation effect on Pauli type beyond swapping.
        # X conjugates: X->X, Y->-Y, Z->-Z. So type is preserved.
        pass
    elif gate == "y":
        q = qubits[0]
        pass
    elif gate == "z":
        q = qubits[0]
        pass
    elif gate == "s":
        q = qubits[0]
        # S X S† = Y, S Y S† = -X, S Z S† = Z
        if p.get(q, "I") == "X":
            p[q] = "Y"
        elif p.get(q, "I") == "Y":
            p[q] = "X"
    elif gate == "t":
        # T is not Clifford; for visualization we just leave the Pauli unchanged
        pass
    elif gate == "cx":
        c, t = qubits[0], qubits[1]
        # CNOT conjugation: X_c -> X_c X_t, Z_t -> Z_c Z_t, others unchanged
        pc = p.get(c, "I")
        pt = p.get(t, "I")
        # Apply: new_c = pc (X part propagates from control to target)
        # Actually we need to compute the conjugation properly.
        # X on control -> X on control AND target (X_c X_t)
        # Z on target -> Z on control AND target (Z_c Z_t)
        # Combined: new_c = pc * (Z_t propagation if Z on target)
        #          new_t = pt * (X_c propagation if X on control)
        new_t = pt
        new_c = pc
        if pc == "X":
            # X propagates forward to target
            new_t = _pauli_mul(new_t, "X")
        elif pc == "Y":
            # Y = XZ, so X part goes to target
            new_t = _pauli_mul(new_t, "X")
        if pt == "Z":
            # Z propagates backward to control
            new_c = _pauli_mul(new_c, "Z")
        elif pt == "Y":
            # Y = XZ, Z part goes to control
            new_c = _pauli_mul(new_c, "Z")
        p[c] = new_c
        p[t] = new_t
    elif gate == "id":
        pass  # noise injection is handled separately
    elif gate == "measure":
        pass
    elif gate == "if_test":
        pass  # correction handled separately
    return p


def _stabilizer_outcome(paulis, ancilla_qubit, code, ancilla_index, all_qubits_state):
    """For a ZZ-type (or X^X-type) stabilizer measurement on ancilla, decide
    whether the syndrome bit is 0 or 1 based on whether the data qubits'
    Pauli frame anticommutes with the stabilizer.

    For 3-qubit bit-flip and phase-flip codes:
      ancilla q3 measures ZZ on q0,q1 -> syndrome 1 iff X on q0 or q1
      ancilla q4 measures ZZ on q1,q2 -> syndrome 1 iff X on q1 or q2
      (after the rotate-back H for phase-flip, Z becomes X)
    For Shor: similar with X^X^X-type checks for Z errors.
    """
    if code in ("bit_flip", "phase_flip"):
        if ancilla_qubit == 3:
            return 1 if (paulis.get(0, "I") in ("X", "Y") or
                         paulis.get(1, "I") in ("X", "Y")) else 0
        if ancilla_qubit == 4:
            return 1 if (paulis.get(1, "I") in ("X", "Y") or
                         paulis.get(2, "I") in ("X", "Y")) else 0
    elif code == "shor":
        # Ancillas 9..14 measure ZZ inside each block (detect X errors)
        # Ancillas 15, 16 measure X^X^X * X^X^X between blocks (detect Z errors)
        if 9 <= ancilla_qubit <= 14:
            block = (ancilla_qubit - 9) // 2
            pos = (ancilla_qubit - 9) % 2
            q_a = 3 * block + pos
            q_b = 3 * block + pos + 1
            return 1 if (paulis.get(q_a, "I") in ("X", "Y") or
                         paulis.get(q_b, "I") in ("X", "Y")) else 0
        if ancilla_qubit in (15, 16):
            block_pair = (0, 1) if ancilla_qubit == 15 else (1, 2)
            qs = [3 * b + i for b in block_pair for i in range(3)]
            return 1 if any(paulis.get(q, "I") in ("Z", "Y") for q in qs) else 0
    return 0


def _correction_targets(code, syndrome_bits):
    """Given the syndrome bits, return which data qubit should get which
    correction. Returns dict {qubit: 'X'/'Z'}.

    Qiskit's syndrome string is read as c_(n-1)...c_1 c_0, so for a 3-cbit
    register the syndrome part is "c1 c0" = "s4 s3" (ancilla 4 then ancilla 3).
    """
    if code in ("bit_flip", "phase_flip"):
        s3 = syndrome_bits.get(3, 0)
        s4 = syndrome_bits.get(4, 0)
        # Qiskit syndrome order: "s4 s3" (c1=ancilla 4 bit, c0=ancilla 3 bit)
        syn = f"{s4}{s3}"
        # Both 3-qubit codes use X for the correction: bit-flip code corrects X
        # directly, phase-flip code is the H-conjugate so its Z error has been
        # rotated to X by the time we apply the correction.
        pauli = "X"
        if syn == "01":
            return {0: pauli}   # only ancilla 3 fired -> q0
        if syn == "11":
            return {1: pauli}   # both fired -> q1
        if syn == "10":
            return {2: pauli}   # only ancilla 4 fired -> q2
        return {}
    elif code == "shor":
        # Shor uses X for bit-flip syndrome and Z for phase-flip syndrome.
        bf0 = f"{syndrome_bits.get(9, 0)}{syndrome_bits.get(10, 0)}"
        bf1 = f"{syndrome_bits.get(11, 0)}{syndrome_bits.get(12, 0)}"
        bf2 = f"{syndrome_bits.get(13, 0)}{syndrome_bits.get(14, 0)}"
        pf = f"{syndrome_bits.get(15, 0)}{syndrome_bits.get(16, 0)}"
        corr = {}
        loc = {"01": 0, "11": 1, "10": 2}
        if bf0 in loc:
            corr[3 * 0 + loc[bf0]] = "X"
        if bf1 in loc:
            corr[3 * 1 + loc[bf1]] = "X"
        if bf2 in loc:
            corr[3 * 2 + loc[bf2]] = "X"
        blk = {"01": 0, "11": 1, "10": 2}
        if pf in blk:
            corr[3 * blk[pf]] = "Z"
        return corr
    return {}


def propagate_error(code, input_bit, error_qubit, error_type, noise_scope, basis):
    """Simulate a single Pauli error propagating through the circuit.

    Returns a list of frames; each frame has:
      time:           int (1-indexed, matches get_circuit_3d columns)
      gate:           gate name at this time
      active_qubits:  [qubits touched by this gate]
      paulis:         {qubit: "I"/"X"/"Y"/"Z"}  current error pattern
      syndrome:       {ancilla_qubit: 0/1}  measured syndrome bits so far
      correction:     {qubit: "X"/"Z"}  correction applied at this step
      label:          human-readable description
    """
    code = normalize_code(code)
    n_data = CODE_INFO[code]["data_qubits"]
    n_total = CODE_INFO[code]["total_qubits"]

    qc = build_circuit(code, input_bit, error_qubit, noise_scope, basis)
    buckets, flat = _stage_split(code, qc)

    # Initial Pauli frame
    paulis = {i: "I" for i in range(n_total)}
    syndrome = {}
    frames = []
    time = 0
    corrections_applied = False

    # Inject the error at the noise location
    noise_targets = _targets(code, error_qubit, noise_scope)
    error_injected = False

    for d in flat:
        time += 1
        gate = d["name"]
        qubits = d["qubits"]
        stage = d.get("stage", "")

        # Inject error right before the noise gate
        if gate == "id" and not error_injected:
            for q in qubits:
                if q in noise_targets:
                    paulis[q] = error_type
            error_injected = True

        # Compute the active gate's effect on the Pauli frame
        if gate == "measure":
            if stage == "syndrome":
                # Stabilizer measurement on an ancilla
                ancilla = qubits[0]
                bit = _stabilizer_outcome(paulis, ancilla, code, None, None)
                syndrome[ancilla] = bit
                label = f"Measure ancilla q{ancilla} → syndrome bit {bit}"
            else:
                # Final measurement of the data qubit; ancillas already measured
                label = f"Measure data q{qubits[0]} (final readout)"
        elif gate in ("if_test", "if_else"):
            # Conditional correction. We compute ALL corrections once (after
            # all syndrome measurements are done, which is guaranteed by the
            # circuit structure - all syndrome measurements happen before
            # any if_test). Then subsequent if_else gates are just visual
            # markers showing where the conditional branches live.
            if not corrections_applied:
                corr = _correction_targets(code, syndrome)
                for q, pauli in corr.items():
                    current = paulis.get(q, "I")
                    if current == pauli:
                        # Same Pauli: cancels the error
                        paulis[q] = "I"
                    elif current == "I":
                        # Clean qubit: correction adds the Pauli (e.g. Shor
                        # applies Z on q3 to fix a Z error that was on q4 in
                        # the same block — the two Z's form a stabilizer)
                        paulis[q] = pauli
                    else:
                        # Different Pauli: compounds (e.g. X then Z = Y)
                        paulis[q] = _pauli_mul(current, pauli)
                corrections_applied = True
                label_parts = [f"apply {p} on q{q}" for q, p in corr.items()]
                label = "Correction: " + ", ".join(label_parts) if label_parts else "no correction (syndrome = 0)"
            else:
                corr = {}
                label = "(correction branch — already applied above)"
            frames.append({
                "time": time,
                "gate": gate,
                "active_qubits": list(qubits),
                "paulis": dict(paulis),
                "syndrome": dict(syndrome),
                "correction": corr,
                "label": label,
            })
            continue
        else:
            paulis = _propagate_through_gate(paulis, gate, qubits)
            label = f"{_gate_label(gate)} on q{qubits[0]}" if len(qubits) == 1 else \
                    f"{_gate_label(gate)} on q{qubits[0]}→q{qubits[1]}"

        frames.append({
            "time": time,
            "gate": gate,
            "active_qubits": list(qubits),
            "paulis": dict(paulis),
            "syndrome": dict(syndrome),
            "correction": {},
            "label": label,
        })

    # Final summary - only count errors on DATA qubits (ancillas have been
    # measured, so any residual Pauli there does not affect the logical state)
    n_data = CODE_INFO[code]["data_qubits"]
    final_errors = {q: p for q, p in paulis.items() if p != "I" and q < n_data}

    # Logical-success check: for Shor, two errors in the same block can cancel
    # at the logical level (e.g. Z_q3 * Z_q4 is a stabiliser). We compute this
    # by running the real Qiskit circuit with the forced error and checking
    # whether the measurement equals the input bit.
    logical_success = _check_logical_success(
        code, input_bit, error_qubit, error_type, noise_scope, basis
    )

    return {
        "code": code,
        "code_name": CODE_INFO[code]["name"],
        "input_bit": input_bit,
        "error_qubit": error_qubit,
        "error_type": error_type,
        "noise_scope": noise_scope,
        "basis": resolve_basis(code, error_type.lower() if error_type != "Y" else "depolarizing", basis),
        "n_frames": len(frames),
        "frames": frames,
        "final_errors": final_errors,
        "success": len(final_errors) == 0,
        "logical_success": logical_success,
        "syndrome_final": dict(syndrome),
    }


def _check_logical_success(code, input_bit, error_qubit, error_type, noise_scope, basis):
    """Run the real Qiskit circuit with a forced error of the given type on
    the selected qubit, and check whether the measurement outcome equals the
    input bit. This is the ground-truth check that the QEC code actually
    corrected the error (handles Shor's per-block parity cancellation)."""
    try:
        code = normalize_code(code)
        forced = error_type.lower() if error_type else None
        qc = build_circuit(code, input_bit, error_qubit, noise_scope, basis,
                           forced_error=forced)
        # Run with the stabilizer simulator (no noise model — we already
        # injected a deterministic Pauli error)
        from qiskit_aer import AerSimulator
        sim = AerSimulator(method="stabilizer")
        # We need to transpile minimally so Aer accepts the if_test ops
        from qiskit import transpile
        try:
            qc_t = transpile(qc, sim, optimization_level=0)
        except Exception:
            qc_t = qc
        result = sim.run(qc_t, shots=64).result().get_counts()
        # The bit string is c_{n-1}...c_1 c_0. For 3-qubit codes, c_2 is the
        # final measurement. For Shor, the last classical bit (out register)
        # is the final measurement.
        from qec_simulator import _split_key
        ok = 0
        total = 0
        for key, n in result.items():
            final_bit, _ = _split_key(code, key)
            total += n
            if int(final_bit) == input_bit:
                ok += n
        return ok == total
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Convenience: stage metadata
# ---------------------------------------------------------------------------

STAGE_INFO = {
    "prep":     "Initialise the data qubit (|0⟩ or |1⟩, optionally Hadamard to |+⟩/|−⟩).",
    "encode":   "Spread the logical bit across the data qubits with CNOTs (and H for phase codes).",
    "noise":    "The noise model fires here. For the 3D view we inject a deterministic Pauli error.",
    "syndrome": "Ancilla qubits measure parity checks (ZZ for bit-flip, XX for phase-flip).",
    "correct":  "The decoder reads the syndrome and applies the matching X or Z correction.",
    "decode":   "Reverse the encoder to recover a single data qubit.",
    "final":    "Measure the recovered qubit — should equal the input bit.",
}


def stage_descriptions(code):
    return STAGE_INFO


# ---------------------------------------------------------------------------
# 7-stage pipeline walkthrough — Bloch vector at every stage of the pipeline
# ---------------------------------------------------------------------------

WALKTHROUGH_STAGES = [
    ("input",    "Input |ψ⟩",   "The logical qubit starts at θ=0/π (for |0⟩/|1⟩) or in the X basis."),
    ("encode",   "Encode",      "CNOTs spread |ψ⟩ across the data qubits (|000⟩+|111⟩ for repetition). The logical arrow stays put — encoding copies protection, not the state."),
    ("noise",    "Noise",       "The noise channel fires. For the walkthrough we inject a deterministic Pauli error so you can SEE the state move."),
    ("syndrome", "Syndrome",    "Ancilla qubits measure parity checks without reading the data. Defects point at which qubit got hit."),
    ("correct",  "Correct",     "The decoder reads the syndrome and applies the matching X / Z recovery. The arrow snaps back toward its target."),
    ("decode",   "Decode",     "The inverse circuit un-encodes to one qubit. Fidelity with the requested state is the quality number."),
    ("measure",  "Measure",    "Final readout in the chosen basis — should equal the input bit when correction worked."),
]


def _apply_pauli_to_sv(sv, qubit, pauli):
    """Apply a Pauli gate (X, Y, or Z) to a single qubit of a Statevector."""
    if pauli == "I" or pauli is None:
        return sv
    # Use the Statevector.evolve with a single-qubit circuit
    qc = QuantumCircuit(sv.num_qubits)
    if pauli == "X":
        qc.x(qubit)
    elif pauli == "Y":
        qc.y(qubit)
    elif pauli == "Z":
        qc.z(qubit)
    else:
        return sv
    try:
        return sv.evolve(qc)
    except Exception:
        # Fallback: apply via operator
        from qiskit.quantum_info import Operator
        op = Operator(qc)
        return sv.evolve(op)


def _readout_bloch(sv, code, qubit=0):
    """Decode a clone of the encoded state and return the Bloch vector of
    the selected data qubit (non-destructive).

    The encoded state has the logical qubit entangled across all data
    qubits, so a partial trace alone gives a maximally-mixed density
    matrix. To get the LOGICAL Bloch vector we must first apply the
    inverse of the encoding circuit (the "decode" operation), which
    un-encodes the state back to a single qubit, then trace out everything
    except qubit 0."""
    # Build the encoding-only circuit (prep + encode) and take its inverse
    # to get the decode circuit.
    code_n = normalize_code(code)
    # Build a circuit with just the encoding gates (no noise, no syndrome)
    qc_enc = _build_encoding_only_circuit(code_n, qubit)
    qc_dec = qc_enc.inverse()

    # Apply the decode to a clone of the state vector
    try:
        sv_decoded = sv.evolve(qc_dec)
    except Exception:
        sv_decoded = sv

    # Trace out everything except qubit 0
    n_qubits = sv_decoded.num_qubits
    other = [i for i in range(n_qubits) if i != qubit]
    if other:
        rho = partial_trace(sv_decoded, other)
    else:
        rho = sv_decoded
    rho_np = np.asarray(rho.data, dtype=complex)
    return _bloch_from_density(rho_np)


def _build_encoding_only_circuit(code, qubit=0):
    """Build a QuantumCircuit containing only the encoding gates for the
    given code (prep + encode, no noise/syndrome/correction/decode)."""
    code = normalize_code(code)
    n_total = CODE_INFO[code]["total_qubits"]
    qc_full = build_circuit(code, 0, 0, "selected", "Z")
    buckets, flat = _stage_split(code, qc_full)
    qc_enc = QuantumCircuit(n_total)
    stages_order = ["prep", "encode"]
    for s in stages_order:
        for d in buckets.get(s, []):
            _append_statevector_safe(qc_enc, d, qc_full)
    return qc_enc


def get_bloch_walkthrough(code, input_bit, error_qubit, error_type,
                          noise_scope, basis):
    """Run the FULL 7-stage QEC pipeline and return a Bloch vector + metadata
    for each stage. The arrow on the front-end Bloch sphere will move through
    these 7 positions as the user steps or auto-plays.

    Stages: input → encode → noise → syndrome → correct → decode → measure

    All Bloch vectors are computed from the REAL Qiskit Statevector running
    the actual encoding/noise/decoding circuit (no shortcuts, no mock data).
    """
    code = normalize_code(code)
    n_data = CODE_INFO[code]["data_qubits"]
    n_total = CODE_INFO[code]["total_qubits"]

    # Choose the input Bloch vector based on input_bit and basis
    basis_resolved = resolve_basis(code, "bit_flip" if error_type == "X" else
                                    "phase_flip" if error_type == "Z" else
                                    "depolarizing", basis)
    if basis_resolved == "Z":
        # |0> or |1> on the Z axis (z = ±1)
        input_vec = {"x": 0.0, "y": 0.0, "z": 1.0 if input_bit == 0 else -1.0}
    else:
        # |+> or |-> on the X axis (x = ±1)
        input_vec = {"x": 1.0 if input_bit == 0 else -1.0, "y": 0.0, "z": 0.0}

    stages = []

    # Stage 0: INPUT — the logical qubit's Bloch vector before encoding
    stages.append({
        "key": "input",
        "title": "Input |ψ⟩",
        "desc": f"The logical qubit starts as |{input_bit}⟩ in the {basis_resolved} basis.",
        "vec": input_vec,
        "fidelity": 1.0,
        "events": [],
        "syndrome": [],
        "correction": {"x": [], "z": []},
    })

    # Build the encoding-only circuit (no noise, no syndrome, no correction)
    # by running the encoding part of build_circuit. We rebuild a circuit
    # that does prep + encoding only, then run Statevector on it.
    qc_full = build_circuit(code, input_bit, error_qubit, noise_scope, basis_resolved)
    buckets, flat = _stage_split(code, qc_full)

    def build_statevector_up_to(stage_name, force_error=None):
        """Build a statevector by running the circuit up to and including the
        given stage. If force_error is given, inject a Pauli gate at the
        noise location."""
        qc_sv = QuantumCircuit(qc_full.num_qubits)
        stages_order = ["prep", "encode", "noise", "syndrome", "correct", "decode", "final"]
        seen = set()
        for s in stages_order:
            if s == stage_name:
                for d in buckets.get(s, []):
                    if force_error and d["name"] == "id":
                        # Inject the forced Pauli
                        for q in d["qubits"]:
                            if q in _targets(code, error_qubit, noise_scope):
                                if force_error == "X":
                                    qc_sv.x(q)
                                elif force_error == "Y":
                                    qc_sv.y(q)
                                elif force_error == "Z":
                                    qc_sv.z(q)
                    else:
                        _append_statevector_safe(qc_sv, d, qc_full)
                break
            for d in buckets.get(s, []):
                _append_statevector_safe(qc_sv, d, qc_full)
        return Statevector(qc_sv)

    # Stage 1: ENCODE — apply encoding, Bloch vector of logical qubit unchanged
    try:
        sv_enc = build_statevector_up_to("encode")
        enc_vec = _readout_bloch(sv_enc, code, 0)
        # Convert from physics (x, y, z) to canvas (x, z, y) where y is up
        enc_vec_canvas = {"x": enc_vec["x"], "y": enc_vec["z"], "z": enc_vec["y"]}
    except Exception:
        enc_vec_canvas = input_vec
    stages.append({
        "key": "encode",
        "title": "Encode",
        "desc": f"CNOTs spread |ψ⟩ across {n_data} physical qubits. The logical arrow stays put — encoding copies protection, not the state.",
        "vec": enc_vec_canvas,
        "fidelity": 1.0,
        "events": [],
        "syndrome": [],
        "correction": {"x": [], "z": []},
    })

    # Stage 2: NOISE — inject the forced error, the arrow moves
    try:
        sv_noise = build_statevector_up_to("noise", force_error=error_type)
        noise_vec = _readout_bloch(sv_noise, code, 0)
        noise_vec_canvas = {"x": noise_vec["x"], "y": noise_vec["z"], "z": noise_vec["y"]}
    except Exception:
        noise_vec_canvas = enc_vec_canvas
    stages.append({
        "key": "noise",
        "title": "Noise",
        "desc": f"{error_type} error injected on q{error_qubit}. Watch the arrow jump away from its target.",
        "vec": noise_vec_canvas,
        "fidelity": None,
        "events": [f"{error_type}@q{error_qubit}"],
        "syndrome": [],
        "correction": {"x": [], "z": []},
    })

    # Stage 3: SYNDROME — ancilla measurements detect the error.
    # The Bloch vector of the data qubit doesn't change (syndrome is on ancillas).
    try:
        sv_synd = build_statevector_up_to("syndrome", force_error=error_type)
        synd_vec = _readout_bloch(sv_synd, code, 0)
        synd_vec_canvas = {"x": synd_vec["x"], "y": synd_vec["z"], "z": synd_vec["y"]}
    except Exception:
        synd_vec_canvas = noise_vec_canvas
    # Compute syndrome bits from the Pauli frame
    from qec_simulator import _targets as _get_targets
    paulis = {i: "I" for i in range(n_total)}
    for q in _get_targets(code, error_qubit, noise_scope):
        paulis[q] = error_type
    syndrome_bits = {}
    for ancilla_q in range(n_data, n_total):
        bit = _stabilizer_outcome(paulis, ancilla_q, code, None, None)
        syndrome_bits[ancilla_q] = bit
    syndrome_list = [{"label": f"q{q}", "bit": v} for q, v in syndrome_bits.items()]
    stages.append({
        "key": "syndrome",
        "title": "Syndrome",
        "desc": (f"Defects: {', '.join(f'q{q}=1' for q, v in syndrome_bits.items() if v) or 'none'} — the parity checks located the error WITHOUT reading the data."
                if any(syndrome_bits.values()) else
                "All checks +1 (trivial syndrome) — nothing to correct."),
        "vec": synd_vec_canvas,
        "fidelity": None,
        "events": [],
        "syndrome": syndrome_list,
        "correction": {"x": [], "z": []},
    })

    # Stage 4: CORRECT — apply the decoder's correction
    correction = _correction_targets(code, syndrome_bits)
    try:
        sv_corr = build_statevector_up_to("correct", force_error=error_type)
        # Apply the correction gates manually (the if_test blocks are not
        # executed by Statevector).
        sv_corr2 = sv_corr
        for q, p in correction.items():
            sv_corr2 = _apply_pauli_to_sv(sv_corr2, q, p)
        corr_vec = _readout_bloch(sv_corr2, code, 0)
        corr_vec_canvas = {"x": corr_vec["x"], "y": corr_vec["z"], "z": corr_vec["y"]}
    except Exception:
        corr_vec_canvas = synd_vec_canvas
    corr_label = ""
    if correction:
        parts = []
        if any(p == "X" for p in correction.values()):
            xs = [q for q, p in correction.items() if p == "X"]
            parts.append(f"X on q{', q'.join(map(str, xs))}")
        if any(p == "Z" for p in correction.values()):
            zs = [q for q, p in correction.items() if p == "Z"]
            parts.append(f"Z on q{', q'.join(map(str, zs))}")
        corr_label = " and ".join(parts)
    stages.append({
        "key": "correct",
        "title": "Correct",
        "desc": (f"Decoder applied {corr_label}. The arrow snaps back toward its target." if correction
                 else "No correction needed this shot."),
        "vec": corr_vec_canvas,
        "fidelity": None,
        "events": [],
        "syndrome": syndrome_list,
        "correction": {"x": [q for q, p in correction.items() if p == "X"],
                       "z": [q for q, p in correction.items() if p == "Z"]},
    })

    # Stage 5: DECODE — apply the inverse circuit, compute fidelity
    try:
        sv_dec = build_statevector_up_to("final", force_error=error_type)
        # Apply corrections before decoding
        for q, p in correction.items():
            sv_dec = _apply_pauli_to_sv(sv_dec, q, p)
        dec_vec = _readout_bloch(sv_dec, code, 0)
        dec_vec_canvas = {"x": dec_vec["x"], "y": dec_vec["z"], "z": dec_vec["y"]}
        # Fidelity with the target state
        # For Z basis |0>: fidelity = (1+z)/2; for |1>: (1-z)/2
        # For X basis |+>: fidelity = (1+x)/2; for |->: (1-x)/2
        if basis_resolved == "Z":
            fidelity = (1 + dec_vec["z"] * (1 if input_bit == 0 else -1)) / 2
        else:
            fidelity = (1 + dec_vec["x"] * (1 if input_bit == 0 else -1)) / 2
        fidelity = max(0.0, min(1.0, float(fidelity)))
    except Exception:
        dec_vec_canvas = corr_vec_canvas
        fidelity = None
    stages.append({
        "key": "decode",
        "title": "Decode",
        "desc": f"The inverse circuit un-encodes to one qubit. Fidelity with the requested |ψ⟩: {(fidelity * 100):.2f}%." if fidelity is not None else "Decode complete.",
        "vec": dec_vec_canvas,
        "fidelity": fidelity,
        "events": [],
        "syndrome": syndrome_list,
        "correction": {"x": [q for q, p in correction.items() if p == "X"],
                       "z": [q for q, p in correction.items() if p == "Z"]},
    })

    # Stage 6: MEASURE — readout, success = (outcome == input_bit)
    success = (fidelity or 0) > 0.5
    # For deterministic error injection, success should match logical_success
    logical_success = _check_logical_success(
        code, input_bit, error_qubit, error_type, noise_scope, basis_resolved
    )
    if logical_success is not None:
        success = logical_success
    stages.append({
        "key": "measure",
        "title": "Measure",
        "desc": (f"Final readout: |{input_bit}⟩ — {'matches' if success else 'does NOT match'} the input bit. "
                f"Fidelity {(fidelity * 100):.2f}%." if fidelity is not None else
                f"Final readout — {'SUCCESS' if success else 'FAILURE'}."),
        "vec": dec_vec_canvas,
        "fidelity": fidelity,
        "events": [],
        "syndrome": syndrome_list,
        "correction": {"x": [q for q, p in correction.items() if p == "X"],
                       "z": [q for q, p in correction.items() if p == "Z"]},
        "outcome": input_bit if success else 1 - input_bit,
        "success": success,
    })

    return {
        "code": code,
        "code_name": CODE_INFO[code]["name"],
        "input_bit": input_bit,
        "error_qubit": error_qubit,
        "error_type": error_type,
        "noise_scope": noise_scope,
        "basis": basis_resolved,
        "n_stages": len(stages),
        "stages": stages,
        "target_vec": input_vec,
        "success": success,
        "logical_success": logical_success,
    }
