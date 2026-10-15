from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, pauli_error, depolarizing_error


# =========================================================
# 3-QUBIT BIT-FLIP QEC
# =========================================================

def bit_flip_qec(input_bit, error_qubit):

    qc = QuantumCircuit(5, 3)

    # -------------------------
    # 1. INPUT
    # -------------------------

    if input_bit == 1:
        qc.x(0)

    # -------------------------
    # 2. QEC ENCODING
    # -------------------------

    qc.cx(0, 1)
    qc.cx(0, 2)

    # -------------------------
    # 3. NOISE INSERTION
    # -------------------------

    qc.id(error_qubit)

    # -------------------------
    # 4. SYNDROME DETECTION
    # -------------------------

    # q3 checks q0 and q1
    qc.cx(0, 3)
    qc.cx(1, 3)

    # q4 checks q1 and q2
    qc.cx(1, 4)
    qc.cx(2, 4)

    # -------------------------
    # 5. MEASURE SYNDROME
    # -------------------------

    qc.measure(3, 0)
    qc.measure(4, 1)

    # -------------------------
    # 6. ERROR CORRECTION
    # -------------------------

    # 01 -> q0 error
    with qc.if_test((qc.cregs[0], 1)):
        qc.x(0)

    # 11 -> q1 error
    with qc.if_test((qc.cregs[0], 3)):
        qc.x(1)

    # 10 -> q2 error
    with qc.if_test((qc.cregs[0], 2)):
        qc.x(2)

    # -------------------------
    # 7. DECODE
    # -------------------------

    qc.cx(0, 1)
    qc.cx(0, 2)

    # -------------------------
    # 8. FINAL MEASUREMENT
    # -------------------------

    qc.measure(0, 2)

    return qc


# =========================================================
# 3-QUBIT PHASE-FLIP QEC
# =========================================================

def phase_flip_qec(input_bit, error_qubit):

    qc = QuantumCircuit(5, 3)

    # -------------------------
    # 1. INPUT
    # -------------------------

    if input_bit == 1:
        qc.x(0)

    # -------------------------
    # 2. CONVERT TO PHASE BASIS
    # -------------------------

    qc.h(0)

    # -------------------------
    # 3. QEC ENCODING
    # -------------------------

    qc.cx(0, 1)
    qc.cx(0, 2)

    # Convert encoded state
    # to phase basis

    qc.h(0)
    qc.h(1)
    qc.h(2)

    # -------------------------
    # 4. NOISE INSERTION
    # -------------------------

    qc.id(error_qubit)

    # -------------------------
    # 5. CONVERT BACK
    # -------------------------

    qc.h(0)
    qc.h(1)
    qc.h(2)

    # -------------------------
    # 6. SYNDROME DETECTION
    # -------------------------

    # q3 checks q0 and q1
    qc.cx(0, 3)
    qc.cx(1, 3)

    # q4 checks q1 and q2
    qc.cx(1, 4)
    qc.cx(2, 4)

    # -------------------------
    # 7. MEASURE SYNDROME
    # -------------------------

    qc.measure(3, 0)
    qc.measure(4, 1)

    # -------------------------
    # 8. ERROR CORRECTION
    # -------------------------

    # 01 -> q0 error
    with qc.if_test((qc.cregs[0], 1)):
        qc.x(0)

    # 11 -> q1 error
    with qc.if_test((qc.cregs[0], 3)):
        qc.x(1)

    # 10 -> q2 error
    with qc.if_test((qc.cregs[0], 2)):
        qc.x(2)

    # -------------------------
    # 9. DECODE
    # -------------------------

    qc.cx(0, 2)
    qc.cx(0, 1)

    # -------------------------
    # 10. RETURN TO ORIGINAL BASIS
    # -------------------------

    qc.h(0)

    # -------------------------
    # 11. FINAL MEASUREMENT
    # -------------------------

    qc.measure(0, 2)

    return qc


# =========================================================
# BUILD NOISE MODEL
# =========================================================

def build_noise_model(noise_type, probability):

    noise_model = NoiseModel()

    # -------------------------
    # BIT-FLIP NOISE
    # -------------------------

    if noise_type == 1:

        # X error with probability p
        # No error with probability 1-p

        error = pauli_error([
            ("X", probability),
            ("I", 1 - probability)
        ])

    # -------------------------
    # PHASE-FLIP NOISE
    # -------------------------

    elif noise_type == 2:

        # Z error with probability p
        # No error with probability 1-p

        error = pauli_error([
            ("Z", probability),
            ("I", 1 - probability)
        ])

    # -------------------------
    # DEPOLARIZING NOISE
    # -------------------------

    else:

        # No error = 1-p
        # X = p/3
        # Y = p/3
        # Z = p/3

        error = depolarizing_error(
            probability,
            1
        )

    # Apply the noise to ID gates.
    # The circuit has one ID gate at
    # the selected error qubit.

    noise_model.add_all_qubit_quantum_error(
        error,
        ["id"]
    )

    return noise_model


# =========================================================
# MAIN PROGRAM
# =========================================================

print("==========================================")
print("       QUANTUM ERROR CORRECTION")
print("             SIMULATOR")
print("==========================================")


# =========================================================
# INPUT BIT
# =========================================================

input_bit = int(
    input("\nEnter input bit (0 or 1): ")
)

if input_bit not in [0, 1]:

    print("Invalid input bit.")
    exit()


# =========================================================
# NOISE MODEL
# =========================================================

print("\nSelect Noise Model:")
print("1. Bit-Flip Noise (X)")
print("2. Phase-Flip Noise (Z)")
print("3. Depolarizing Noise")

noise_type = int(
    input("Enter noise choice (1, 2 or 3): ")
)

if noise_type not in [1, 2, 3]:

    print("Invalid noise choice.")
    exit()


# =========================================================
# NOISE PROBABILITY
# =========================================================

print("\nEnter noise probability.")

probability = float(
    input("Probability (0 to 1): ")
)

if probability < 0 or probability > 1:

    print("Probability must be between 0 and 1.")
    exit()


# =========================================================
# QEC CODE
# =========================================================

print("\nSelect QEC Code:")
print("1. 3-Qubit Bit-Flip QEC")
print("2. 3-Qubit Phase-Flip QEC")

qec_type = int(
    input("Enter QEC choice (1 or 2): ")
)

if qec_type not in [1, 2]:

    print("Invalid QEC choice.")
    exit()


# =========================================================
# ERROR QUBIT
# =========================================================

error_qubit = int(
    input("\nEnter error qubit (0, 1, or 2): ")
)

if error_qubit not in [0, 1, 2]:

    print("Invalid error qubit.")
    exit()


# =========================================================
# NAMES
# =========================================================

noise_name = {
    1: "Bit-Flip Noise (X)",
    2: "Phase-Flip Noise (Z)",
    3: "Depolarizing Noise"
}

qec_name = {
    1: "3-Qubit Bit-Flip QEC",
    2: "3-Qubit Phase-Flip QEC"
}


# =========================================================
# DISPLAY SELECTION
# =========================================================

print("\n==========================================")
print("              SELECTION")
print("==========================================")

print("Input bit        :", input_bit)
print("Noise model      :", noise_name[noise_type])
print("Noise probability:", probability)
print("QEC code         :", qec_name[qec_type])
print("Error qubit      :", error_qubit)


# =========================================================
# QEC STATUS
# =========================================================

if noise_type == 1 and qec_type == 1:

    print("\nQEC STATUS      : MATCHED")
    print("Bit-flip noise is being tested")
    print("using the 3-qubit Bit-Flip QEC.")

elif noise_type == 2 and qec_type == 2:

    print("\nQEC STATUS      : MATCHED")
    print("Phase-flip noise is being tested")
    print("using the 3-qubit Phase-Flip QEC.")

elif noise_type == 3:

    print("\nQEC STATUS      : DEPOLARIZING")
    print("Depolarizing noise is being tested")
    print("with the selected QEC code.")

else:

    print("\nQEC STATUS      : NOT MATCHED")
    print("The selected QEC code is not")
    print("specifically matched to this noise.")


# =========================================================
# BUILD SELECTED QEC CIRCUIT
# =========================================================

if qec_type == 1:

    qc = bit_flip_qec(
        input_bit,
        error_qubit
    )

else:

    qc = phase_flip_qec(
        input_bit,
        error_qubit
    )


# =========================================================
# BUILD NOISE MODEL
# =========================================================

noise_model = build_noise_model(
    noise_type,
    probability
)


# =========================================================
# SIMULATION
# =========================================================

simulator = AerSimulator(
    noise_model=noise_model
)

result = simulator.run(
    qc,
    shots=1000
).result()

counts = result.get_counts()


# =========================================================
# DISPLAY RESULTS
# =========================================================

print("\n==========================================")
print("              SIMULATION")
print("==========================================")

print("Measurement results:", counts)


# =========================================================
# INTERPRET RESULTS
# =========================================================

print("\n==========================================")
print("             INTERPRETATION")
print("==========================================")

total_shots = sum(
    counts.values()
)

successful_shots = 0
failed_shots = 0

for result_string, number in counts.items():

    # Qiskit displays c2 c1 c0

    final_bit = result_string[0]
    syndrome = result_string[1:]

    if int(final_bit) == input_bit:

        successful_shots += number

    else:

        failed_shots += number

    print(
        f"{result_string} -> "
        f"Final bit = {final_bit}, "
        f"Syndrome = {syndrome}, "
        f"Shots = {number}"
    )


# =========================================================
# PERFORMANCE ANALYSIS
# =========================================================

success_rate = (
    successful_shots / total_shots
) * 100

error_rate = (
    failed_shots / total_shots
) * 100


print("\n==========================================")
print("          PERFORMANCE ANALYSIS")
print("==========================================")

print("Total shots      :", total_shots)
print("Successful shots :", successful_shots)
print("Failed shots     :", failed_shots)
print("Success rate     :", f"{success_rate:.2f}%")
print("Error rate       :", f"{error_rate:.2f}%")


# =========================================================
# EXPECTED RESULT
# =========================================================

print("\nExpected original input bit:", input_bit)
print("Expected final bit:", input_bit)


# =========================================================
# SYNDROME TABLE
# =========================================================

print("\nSyndrome Table:")
print("00 -> No error")
print("01 -> q0 error")
print("11 -> q1 error")
print("10 -> q2 error")


# =========================================================
# CIRCUIT
# =========================================================

print("\n==========================================")
print("                CIRCUIT")
print("==========================================")

print(qc)