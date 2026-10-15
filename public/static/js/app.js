/* app.js - front end for the QEC simulator. All numbers shown come from the Flask/Qiskit backend. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CODE_NAMES = { bit_flip: "3-Qubit Bit-Flip QEC", phase_flip: "3-Qubit Phase-Flip QEC", shor: "9-Qubit Shor QEC" };
  const NOISE_NAMES = { bit_flip: "Bit-Flip Noise (X)", phase_flip: "Phase-Flip Noise (Z)", depolarizing: "Depolarizing Noise" };
  const DATA_QUBITS = { bit_flip: 3, phase_flip: 3, shor: 9 };
  const DEFAULTS = { bit: "0", code: "bit_flip", noise: "bit_flip", prob: 20, scope: "selected", qubit: "1", basis: "auto", shots: 1000, step: 10 };

  let inputBit = 0;
  let circuitText = "";
  let circuitFont = 13;
  let sweep = null;          // { rows, csvFile }
  let chart = null;
  let metric = "success";
  let busy = false;
  let circuitTimer = null;

  /* ------------------------------------------------------------------ helpers */
  async function api(path, body) {
    const opt = body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    };
    let res;
    try { res = await fetch(path, opt); }
    catch (e) { throw new Error("Cannot reach the simulator backend. Is app.py still running?"); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* not json */ }
    if (!res.ok || !data || data.ok === false) {
      const errs = data && data.errors ? data.errors : ["Request failed (HTTP " + res.status + ")."];
      const err = new Error(errs.join(" "));
      err.list = errs;
      throw err;
    }
    return data;
  }

  function getConfig() {
    return {
      code: $("codeSel").value,
      noise: $("noiseSel").value,
      input_bit: inputBit,
      probability_percent: parseFloat($("probNum").value),
      shots: parseInt($("shotsNum").value, 10),
      noise_scope: $("scopeSel").value,
      error_qubit: parseInt($("qubitSel").value || "0", 10),
      basis: $("basisSel").value,
      step_percent: parseFloat($("stepNum").value),
    };
  }

  function fmtPct(x) { return x.toFixed(2) + "%"; }
  function clientErrors(cfg) {
    const e = [];
    if (!(cfg.probability_percent >= 0 && cfg.probability_percent <= 100)) e.push("Noise probability must be between 0 and 100 %.");
    if (!(cfg.shots >= 1 && cfg.shots <= 20000) || !Number.isInteger(cfg.shots)) e.push("Shots must be a whole number between 1 and 20000.");
    if (!(cfg.step_percent >= 0.5 && cfg.step_percent <= 100)) e.push("Step must be between 0.5 and 100 percent.");
    return e;
  }
  function showErrors(list) {
    const box = $("errorBox");
    if (!list || !list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = list.length === 1 ? escapeHtml(list[0]) : "<ul>" + list.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") + "</ul>";
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function setStatus(kind, text) {
    const el = $("sumStatus");
    el.className = "badge badge-" + kind;
    el.textContent = text;
  }
  function setBusy(b) {
    busy = b;
    ["runBtn", "validateBtn", "autoBtn", "resetBtn"].forEach((id) => ($(id).disabled = b));
  }

  /* ------------------------------------------------------------------ form logic */
  function fillQubitOptions() {
    const n = DATA_QUBITS[$("codeSel").value];
    const sel = $("qubitSel");
    const prev = parseInt(sel.value || "0", 10);
    sel.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = "q" + i;
      sel.appendChild(o);
    }
    sel.value = String(prev < n ? prev : 0);
  }

  function syncDisabled() {
    const all = $("scopeSel").value === "all";
    $("qubitSel").disabled = all;
    $("qubitField").style.opacity = all ? ".5" : "1";
  }

  function updateSummary() {
    const c = getConfig();
    $("sumCode").textContent = CODE_NAMES[c.code];
    $("sumNoise").textContent = NOISE_NAMES[c.noise];
    $("sumProb").textContent = isNaN(c.probability_percent) ? "–" : c.probability_percent + " %";
    $("sumScope").textContent = c.noise_scope === "all"
      ? "All " + DATA_QUBITS[c.code] + " data qubits (independent)"
      : "Data qubit q" + c.error_qubit;
    $("sumData").textContent = DATA_QUBITS[c.code];
    $("sumShots").textContent = isNaN(c.shots) ? "–" : c.shots;
    $("sumBasis").textContent = c.basis === "auto" ? "Auto" : c.basis;
  }

  function onProbRange() { $("probNum").value = $("probRange").value; onConfigChange(); }
  function onProbNum() {
    const v = parseFloat($("probNum").value);
    if (!isNaN(v)) $("probRange").value = Math.min(100, Math.max(0, v));
    onConfigChange();
  }

  function onConfigChange() {
    syncDisabled();
    updateSummary();
    clearTimeout(circuitTimer);
    circuitTimer = setTimeout(refreshCircuit, 150);
  }

  /* ------------------------------------------------------------------ circuit card */
  async function refreshCircuit() {
    const cfg = getConfig();
    const errs = clientErrors({ ...cfg, shots: 1000, step_percent: 10 }).filter((m) => m.includes("probability"));
    if (errs.length) { showErrors(errs); return; }
    showErrors([]);
    try {
      const d = await api("/api/circuit", { ...cfg, shots: 1000, step_percent: 10 });
      setCircuit(d.circuit);
      $("circChips").innerHTML = [
        d.stats.qubits + " qubits", d.stats.clbits + " classical bits", "depth " + d.stats.depth, d.stats.size + " operations",
      ].map((t) => '<span class="chip">' + t + "</span>").join("");
      $("basisHint").textContent = "Resolved basis: " + d.basis + (d.basis === "X" ? " (input |+⟩ for 0, |−⟩ for 1)" : " (input |0⟩ or |1⟩)");
      $("sumBasis").textContent = d.basis + (cfg.basis === "auto" ? " (auto)" : "");
      $("sumExplain").textContent = d.explanation;
      showCompat(d.status, d.messages);
    } catch (e) {
      showErrors(e.list || [e.message]);
    }
  }

  function showCompat(status, msgs) {
    const box = $("compatBox");
    if (!msgs || !msgs.length) { box.hidden = true; return; }
    box.hidden = false;
    box.className = "alert " + (status === "MATCHED" ? "alert-ok" : status === "PARTIAL" ? "alert-warn" : "alert-error");
    box.innerHTML = "<strong>QEC status: " + escapeHtml(status) + "</strong><ul>" + msgs.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") + "</ul>";
  }

  function setCircuit(text) {
    circuitText = text;
    $("circuitPre").textContent = text;
    $("circuitPreLarge").textContent = text;
    applyCircuitFont();
  }
  function applyCircuitFont() {
    $("circuitPre").style.fontSize = circuitFont + "px";
    $("circuitPreLarge").style.fontSize = Math.max(circuitFont, 14) + "px";
  }
  function fitCircuit() {
    const lines = circuitText.split("\n");
    const maxLen = Math.max(...lines.map((l) => l.length), 1);
    const avail = $("circuitBox").clientWidth - 28;
    const fs = Math.floor(avail / (maxLen * 0.6));
    circuitFont = Math.max(7, Math.min(16, fs));   // never smaller than 7px: scroll instead
    applyCircuitFont();
  }

  function circuitToPngBlob(cb) {
    const lines = circuitText.split("\n");
    const fs = 16, pad = 20, scale = 2;
    const font = fs + 'px "Cascadia Mono", Consolas, "DejaVu Sans Mono", Menlo, monospace';
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const mm = probe.measureText("M");
    const cw = mm.width;
    const lh = mm.fontBoundingBoxAscent ? Math.round(mm.fontBoundingBoxAscent + mm.fontBoundingBoxDescent) : Math.round(fs * 1.17);
    const maxLen = Math.max(...lines.map((l) => l.length), 1);
    const W = Math.ceil(maxLen * cw + pad * 2), H = lines.length * lh + pad * 2;
    if (W * scale > 16000) { return cb(null, "Circuit is too wide for a single PNG; use Download TXT instead."); }
    const cv = document.createElement("canvas");
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#0c1329"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#dfe6ff"; ctx.font = font; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * lh));
    cv.toBlob((b) => cb(b, null), "image/png");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function circuitFileBase() {
    const c = getConfig();
    return "circuit_" + c.code + "_input" + c.input_bit;
  }

  /* ------------------------------------------------------------------ results */
  function renderResult(r) {
    const q = r.qec, c = r.config;
    $("resEmpty").hidden = true; $("resBody").hidden = false;
    $("tSuccessRate").textContent = fmtPct(q.success_rate);
    $("tErrorRate").textContent = fmtPct(q.error_rate);
    $("tSuccess").textContent = q.successful_shots;
    $("tFail").textContent = q.failed_shots;
    $("tDetected").textContent = q.detected_count;
    $("tCorrected").textContent = q.correction_success_count;

    let txt;
    if (c.probability === 0) {
      txt = "No noise was applied, so every shot should return the original bit. Result: " + fmtPct(q.success_rate) + " success.";
    } else {
      txt = "Out of " + q.total_shots + " shots, " + q.successful_shots + " returned the original logical bit " + c.input_bit +
        " (" + fmtPct(q.success_rate) + " ± " + q.success_rate_se.toFixed(1) + "). The syndrome flagged an error in " + q.detected_count +
        " shots; in " + q.correction_success_count + " of those the logical bit was recovered" +
        (q.detected_failure_count ? ", and " + q.detected_failure_count + " still failed after the correction (the correction was wrong, so more than one error probably occurred)" : "") + ". " +
        (q.undetected_failure_count ? q.undetected_failure_count + " shots failed with a clean syndrome (an error the code cannot see)." : "No failure went completely undetected.");
      if (r.improvement !== undefined) {
        txt += " Compared with an unprotected qubit, QEC changed the success rate by " + (r.improvement >= 0 ? "+" : "") + r.improvement.toFixed(2) + " percentage points.";
      }
    }
    $("interp").textContent = txt;
    $("reportPre").textContent = r.report;

    const tb = $("outcomeTable").querySelector("tbody");
    tb.innerHTML = q.syndrome_rows.map((row) =>
      "<tr><td class='mono'>" + escapeHtml(row.key) + "</td><td>" + row.final_bit + "</td><td class='mono'>" + row.syndrome +
      "</td><td>" + escapeHtml(row.meaning) + "</td><td class='num'>" + row.shots + "</td><td class='" + (row.correct ? "ok" : "fail") + "'>" +
      (row.correct ? "Correct" : "Wrong") + "</td></tr>").join("");

    if (r.baseline) {
      $("cmpEmpty").hidden = true; $("cmpBody").hidden = false;
      $("cmpCodeName").textContent = c.code_name;
      $("barBase").style.width = r.baseline.success_rate + "%";
      $("barQec").style.width = q.success_rate + "%";
      $("cmpBaseSucc").textContent = fmtPct(r.baseline.success_rate);
      $("cmpBaseErr").textContent = fmtPct(r.baseline.error_rate);
      $("cmpQecSucc").textContent = fmtPct(q.success_rate);
      $("cmpQecErr").textContent = fmtPct(q.error_rate);
      const im = $("cmpImpr");
      im.textContent = (r.improvement >= 0 ? "+" : "") + r.improvement.toFixed(2);
      im.className = "impr-val " + (r.improvement > 0.0001 ? "pos" : r.improvement < -0.0001 ? "neg" : "");
      $("cmpNote").textContent = r.comparison_note;
    }
    showCompat(r.status, r.messages);
    $("sumExplain").textContent = r.explanation;
    $("sumBasis").textContent = c.basis + (getConfig().basis === "auto" ? " (auto)" : "");
  }

  async function runSimulation() {
    const cfg = getConfig();
    const errs = clientErrors(cfg).filter((m) => !m.startsWith("Step"));
    if (errs.length) { showErrors(errs); setStatus("err", "Invalid input"); return; }
    showErrors([]);
    setBusy(true); setStatus("run", "Running…");
    try {
      const r = await api("/api/run", cfg);
      renderResult(r);
      setCircuit(r.circuit);
      setStatus("done", "Completed");
    } catch (e) {
      showErrors(e.list || [e.message]); setStatus("err", "Error");
    } finally { setBusy(false); }
  }

  async function runValidation() {
    const cfg = getConfig();
    showErrors([]);
    setBusy(true); setStatus("run", "Validating…");
    try {
      const v = await api("/api/validate", { ...cfg, probability_percent: 0 });
      $("validateCard").hidden = false;
      $("valSummary").textContent = v.code_name + ": " + (v.all_passed
        ? "all " + v.tests.length + " validation tests behaved as expected. Each test is a real Qiskit run; \"not recovered (code limitation)\" rows show errors the code is not designed to fix."
        : "some tests did NOT behave as expected - see the table.");
      $("valTable").querySelector("tbody").innerHTML = v.tests.map((t) =>
        "<tr><td>" + escapeHtml(t.test) + "</td><td>" + escapeHtml(t.expected) + "</td><td>" + escapeHtml(t.observed) +
        "</td><td class='" + (t.passed ? "ok" : "fail") + "'>" + (t.passed ? "PASS" : "FAIL") + "</td></tr>").join("");
      $("validateCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
      setStatus("done", v.all_passed ? "Validation passed" : "Validation failed");
    } catch (e) {
      showErrors(e.list || [e.message]); setStatus("err", "Error");
    } finally { setBusy(false); }
  }

  /* ------------------------------------------------------------------ performance */
  function perfMessage(kind, html) {
    const el = $("perfMsg");
    if (!html) { el.hidden = true; return; }
    el.hidden = false;
    el.className = "alert alert-" + kind;
    el.innerHTML = html;
  }

  const bgPlugin = {
    id: "bg",
    beforeDraw(ch) {
      const ctx = ch.canvas.getContext("2d");
      ctx.save(); ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#0f1730"; ctx.fillRect(0, 0, ch.width, ch.height); ctx.restore();
    },
  };

  function drawChart() {
    if (!sweep) return;
    const rows = sweep.rows;
    const labels = rows.map((r) => r.probability_percent);
    const key = metric === "success" ? ["without_qec_success", "with_qec_success"] : ["without_qec_error", "with_qec_error"];
    const yTitle = metric === "success" ? "Logical success rate (%)" : "Logical error rate (%)";
    const data = {
      labels,
      datasets: [
        { label: "Without QEC", data: rows.map((r) => r[key[0]]), borderColor: "#ff9f6b", backgroundColor: "#ff9f6b", tension: 0.15, pointRadius: 4 },
        { label: "With " + rows[0].qec_code, data: rows.map((r) => r[key[1]]), borderColor: "#7aa2ff", backgroundColor: "#7aa2ff", tension: 0.15, pointRadius: 4 },
      ],
    };
    const opts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      scales: {
        x: { title: { display: true, text: "Noise probability (%)", color: "#c9d3ff" }, ticks: { color: "#8f9bc7" }, grid: { color: "#243257" } },
        y: { min: 0, max: 100, title: { display: true, text: yTitle, color: "#c9d3ff" }, ticks: { color: "#8f9bc7" }, grid: { color: "#243257" } },
      },
      plugins: {
        legend: { labels: { color: "#e8ecff" } },
        title: { display: true, color: "#e8ecff", text: rows[0].qec_code + " · " + rows[0].noise_model + " · " + (rows[0].noise_scope === "all" ? "all data qubits" : "selected qubit") + " · basis " + rows[0].basis + " · " + rows[0].shots + " shots" },
      },
    };
    $("chartWrap").hidden = false;
    if (chart) chart.destroy();
    chart = new Chart($("perfChart"), { type: "line", data, options: opts, plugins: [bgPlugin] });
  }

  function renderSweepTable() {
    $("perfEmpty").hidden = true;
    $("perfTableWrap").hidden = false;
    $("perfTable").querySelector("tbody").innerHTML = sweep.rows.map((r) =>
      "<tr><td class='num'>" + r.probability_percent + "</td><td class='num'>" + r.without_qec_success.toFixed(2) + "</td><td class='num'>" + r.with_qec_success.toFixed(2) +
      "</td><td class='num'>" + r.without_qec_error.toFixed(2) + "</td><td class='num'>" + r.with_qec_error.toFixed(2) +
      "</td><td class='num " + (r.improvement > 0.0001 ? "ok" : r.improvement < -0.0001 ? "fail" : "") + "'>" + (r.improvement >= 0 ? "+" : "") + r.improvement.toFixed(2) + "</td></tr>").join("");
    const r0 = sweep.rows[0];
    $("perfMeta").textContent = r0.qec_code + ", " + r0.noise_model + ", noise on " + (r0.noise_scope === "all" ? "all data qubits" : "one selected data qubit") +
      ", logical basis " + r0.basis + ", " + r0.shots + " shots per point. Every point is a fresh simulation, so small random variation is expected.";
  }

  async function runSweep() {
    const cfg = getConfig();
    const errs = clientErrors(cfg);
    if (errs.length) { showErrors(errs); return; }
    showErrors([]);
    setBusy(true); setStatus("run", "Sweeping…");
    $("csvBtn").disabled = true; $("pngBtn").disabled = true;
    const n = Math.floor(100 / cfg.step_percent + 1e-9) + 1 + (100 % cfg.step_percent === 0 ? 0 : 1);
    perfMessage("info", "Simulating " + n + " noise probabilities × 2 circuits (" + cfg.shots + " shots each)…");
    try {
      const d = await api("/api/experiment", cfg);
      sweep = { rows: d.rows, csvFile: d.csv_file };
      renderSweepTable(); drawChart();
      $("pngBtn").disabled = false;
      if (d.csv_file) {
        $("csvBtn").disabled = false;
        perfMessage("ok", "Done: " + d.rows.length + " points measured. CSV saved to <code>output/" + escapeHtml(d.csv_file) + "</code>.");
      } else {
        perfMessage("warn", "Measurements finished, but the CSV could not be saved: " + escapeHtml(d.csv_error || "unknown error"));
      }
      setStatus("done", "Completed");
    } catch (e) {
      perfMessage("error", escapeHtml(e.message)); setStatus("err", "Error");
    } finally { setBusy(false); }
  }

  function downloadCsv() {
    if (!sweep || !sweep.csvFile) return;
    const a = document.createElement("a");
    a.href = "/api/download/" + encodeURIComponent(sweep.csvFile);
    a.download = sweep.csvFile;
    document.body.appendChild(a); a.click(); a.remove();
    perfMessage("ok", "CSV downloaded: <code>" + escapeHtml(sweep.csvFile) + "</code> (also stored in the project's <code>output/</code> folder).");
  }

  async function downloadGraph() {
    if (!chart) return;
    try {
      const url = chart.toBase64Image("image/png", 1);
      const label = "qec_graph_" + metric + "_" + sweep.rows[0].qec_code;
      const d = await api("/api/save_graph", { image: url, label });
      const a = document.createElement("a");
      a.href = "/api/download/" + encodeURIComponent(d.file);
      a.download = d.file;
      document.body.appendChild(a); a.click(); a.remove();
      perfMessage("ok", "Graph downloaded: <code>" + escapeHtml(d.file) + "</code> (also stored in the project's <code>output/</code> folder).");
    } catch (e) {
      perfMessage("error", "Could not save the graph: " + escapeHtml(e.message));
    }
  }

  /* ------------------------------------------------------------------ reset */
  function resetAll() {
    inputBit = parseInt(DEFAULTS.bit, 10);
    document.querySelectorAll("#inputBitSeg .seg").forEach((b) => b.classList.toggle("active", b.dataset.value === DEFAULTS.bit));
    $("codeSel").value = DEFAULTS.code; $("noiseSel").value = DEFAULTS.noise;
    $("probRange").value = DEFAULTS.prob; $("probNum").value = DEFAULTS.prob;
    $("scopeSel").value = DEFAULTS.scope; fillQubitOptions(); $("qubitSel").value = DEFAULTS.qubit;
    $("basisSel").value = DEFAULTS.basis; $("shotsNum").value = DEFAULTS.shots; $("stepNum").value = DEFAULTS.step;
    showErrors([]); perfMessage("", "");
    $("resEmpty").hidden = false; $("resBody").hidden = true;
    $("cmpEmpty").hidden = false; $("cmpBody").hidden = true;
    $("validateCard").hidden = true;
    if (chart) { chart.destroy(); chart = null; }
    $("chartWrap").hidden = true;
    sweep = null; $("perfEmpty").hidden = false; $("perfTableWrap").hidden = true; $("perfMeta").textContent = "";
    $("csvBtn").disabled = true; $("pngBtn").disabled = true;
    circuitFont = 13;
    setStatus("idle", "Ready");
    onConfigChange();
  }

  /* ------------------------------------------------------------------ init */
  async function checkBackend() {
    try {
      const s = await api("/api/status");
      $("backendDot").className = "dot dot-ok";
      $("backendText").textContent = "Backend online · Qiskit " + s.qiskit + " · Aer " + s.qiskit_aer;
    } catch (e) {
      $("backendDot").className = "dot dot-bad";
      $("backendText").textContent = "Backend unavailable";
    }
  }

  function init() {
    fillQubitOptions(); $("qubitSel").value = DEFAULTS.qubit;

    document.querySelectorAll("#inputBitSeg .seg").forEach((b) => b.addEventListener("click", () => {
      inputBit = parseInt(b.dataset.value, 10);
      document.querySelectorAll("#inputBitSeg .seg").forEach((x) => x.classList.toggle("active", x === b));
      onConfigChange();
    }));
    $("codeSel").addEventListener("change", () => { fillQubitOptions(); onConfigChange(); });
    ["noiseSel", "scopeSel", "qubitSel", "basisSel", "shotsNum"].forEach((id) => $(id).addEventListener("change", onConfigChange));
    $("shotsNum").addEventListener("input", updateSummary);
    $("probRange").addEventListener("input", onProbRange);
    $("probNum").addEventListener("input", onProbNum);

    $("runBtn").addEventListener("click", runSimulation);
    $("validateBtn").addEventListener("click", runValidation);
    $("resetBtn").addEventListener("click", resetAll);
    $("autoBtn").addEventListener("click", runSweep);
    $("csvBtn").addEventListener("click", downloadCsv);
    $("pngBtn").addEventListener("click", downloadGraph);
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
      metric = t.dataset.metric;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      drawChart();
    }));

    $("zoomIn").addEventListener("click", () => { circuitFont = Math.min(24, circuitFont + 1); applyCircuitFont(); });
    $("zoomOut").addEventListener("click", () => { circuitFont = Math.max(7, circuitFont - 1); applyCircuitFont(); });
    $("zoomFit").addEventListener("click", fitCircuit);
    $("expandCirc").addEventListener("click", () => $("circuitDialog").showModal());
    $("closeDialog").addEventListener("click", () => $("circuitDialog").close());
    $("dlCircTxt").addEventListener("click", () => downloadBlob(new Blob([circuitText], { type: "text/plain" }), circuitFileBase() + ".txt"));
    $("dlCircPng").addEventListener("click", () => circuitToPngBlob((blob, err) => {
      if (err) { alert(err); return; }
      downloadBlob(blob, circuitFileBase() + ".png");
    }));

    checkBackend();
    onConfigChange();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
