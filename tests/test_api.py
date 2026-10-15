"""
End-to-end API test against a RUNNING server (python app.py).
Run:  python tests/test_api.py
"""
import base64, io, json, sys, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:5000"
ok_all = True

def call(path, body=None, raw=False):
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    req = urllib.request.Request(BASE + path, data, {"Content-Type": "application/json"} if data else {})
    try:
        r = urllib.request.urlopen(req)
        out = r.read()
        return r.status, (out if raw else json.loads(out))
    except urllib.error.HTTPError as e:
        out = e.read()
        return e.code, (out if raw else json.loads(out))

def check(cond, text):
    global ok_all
    ok_all &= bool(cond)
    print(f"[{'PASS' if cond else 'FAIL'}] {text}")

base = dict(code="bit_flip", noise="bit_flip", input_bit=1, probability_percent=20, shots=1000,
            noise_scope="selected", error_qubit=1, basis="auto", step_percent=10)

s, d = call("/api/status");                      check(s == 200 and d["ok"], f"status: Qiskit {d.get('qiskit')}, Aer {d.get('qiskit_aer')}")
s, d = call("/api/run", base);                   check(s == 200 and d["qec"]["success_rate"] == 100.0, f"bit-flip run: counts {d['counts']}")

for code in ("bit_flip", "phase_flip", "shor"):
    s, d = call("/api/circuit", {**base, "code": code, "noise": "depolarizing", "error_qubit": 2})
    expect = {"bit_flip": 5, "phase_flip": 5, "shor": 17}[code]
    check(s == 200 and d["stats"]["qubits"] == expect and "q_0" in d["circuit"], f"circuit {code}: {d['stats']['qubits']} qubits, {d['stats']['size']} ops")

s, d = call("/api/run", {**base, "code": "shor", "noise": "depolarizing", "probability_percent": 50, "error_qubit": 4})
check(s == 200 and d["qec"]["success_rate"] == 100.0 and d["baseline"]["success_rate"] < 90, f"Shor single-qubit depolarizing p=50%: QEC {d['qec']['success_rate']}% vs bare {d['baseline']['success_rate']}%")
s, d = call("/api/run", {**base, "code": "bit_flip", "noise": "phase_flip", "probability_percent": 30})
check(s == 200 and d["status"] == "NOT MATCHED", f"mismatch warning shown: {d['status']}")
s, d = call("/api/run", {**base, "code": "bit_flip", "noise": "depolarizing", "probability_percent": 30})
check(s == 200 and d["status"] == "PARTIAL", f"depolarizing warning shown: {d['status']}")

s, d = call("/api/run", {**base, "code": "xyz", "input_bit": 2, "probability_percent": 150, "shots": 0, "error_qubit": 7})
check(s == 400 and len(d["errors"]) >= 4, f"invalid input rejected with {len(d.get('errors', []))} messages")
s, d = call("/api/run", {**base, "error_qubit": 5}); check(s == 400, "error qubit out of range rejected")
s, d = call("/api/run", b"garbage");                  check(s == 400, "non-JSON body rejected")

for code in ("bit_flip", "phase_flip", "shor"):
    s, d = call("/api/validate", {**base, "code": code})
    check(s == 200 and d["all_passed"], f"noise-free/controlled-error validation {code}: {len(d['tests'])} tests")

t = time.time()
s, d = call("/api/experiment", {**base, "code": "shor", "noise": "depolarizing", "noise_scope": "all", "step_percent": 10})
check(s == 200 and len(d["rows"]) == 11 and d["csv_file"], f"sweep: {len(d['rows'])} points in {time.time()-t:.1f}s, csv={d['csv_file']}")
rows = d["rows"]
check(rows[0]["with_qec_success"] == 100 and rows[0]["without_qec_success"] == 100, "p=0 gives 100% for both")
print("   p%   without  with   improvement")
for r in rows: print(f"  {r['probability_percent']:5.0f}  {r['without_qec_success']:6.1f}  {r['with_qec_success']:6.1f}  {r['improvement']:+6.1f}")
s, csv = call("/api/download/" + d["csv_file"], raw=True)
check(s == 200 and csv.decode().count("\n") == 12, f"CSV download: {len(csv)} bytes, header: {csv.decode().splitlines()[0][:60]}...")

import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig = plt.figure(figsize=(3, 2)); plt.plot([0, 1], [0, 1]); b = io.BytesIO(); fig.savefig(b, format="png")
s, g = call("/api/save_graph", {"image": "data:image/png;base64," + base64.b64encode(b.getvalue()).decode(), "label": "qec graph success"})
check(s == 200, f"graph saved: {g.get('file')}")
s, png = call("/api/download/" + g["file"], raw=True)
check(s == 200 and png[:8] == b"\x89PNG\r\n\x1a\n", "PNG download returns a real PNG")
s, g = call("/api/save_graph", {"image": "not an image"}); check(s == 400, "bad PNG upload rejected")
s, g = call("/api/download/secret.txt", raw=True);        check(s == 400, "non csv/png download refused")

print("\nALL API TESTS PASSED" if ok_all else "\nSOME API TESTS FAILED")
sys.exit(0 if ok_all else 1)
