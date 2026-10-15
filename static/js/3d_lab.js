/* 3d_lab.js — 3D Simulator Lab for the QEC simulator.
 *
 * Uses the custom Canvas-2D 3D engine (3d_engine.js, zero dependencies) to
 * render:
 *   A. Bloch Sphere — interactive 7-stage pipeline walkthrough
 *      (input → encode → noise → syndrome → correct → decode → measure)
 *      with a wireframe sphere, glowing state arrow, target pin, and
 *      auto-play that moves the arrow through each stage as the REAL
 *      Qiskit state-vector engine computes it.
 *   B. 3D Circuit & Error Propagation — a 3D perspective circuit board
 *      with qubit rails, glowing gate bars (CNOTs, H gates), and Pauli
 *      error pulses that propagate through the gates in real time using
 *      exact Clifford conjugation rules.
 *
 * Both views are driven by the existing experiment configuration panel on
 * the left, and call the /api/3d/* endpoints backed by the same
 * Flask + Qiskit Aer engine.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const E = window.Qec3D;
  if (!E) { console.warn("3D engine not loaded — 3D Lab disabled."); return; }

  const CODE_NAMES = {
    bit_flip: "3-Qubit Bit-Flip", phase_flip: "3-Qubit Phase-Flip", shor: "9-Qubit Shor"
  };
  const PAULI_COLOR = { I: "#3ddc97", X: "#fb7185", Y: "#e879f9", Z: "#fbbf24" };

  // ---------- shared state ----------
  let activeTab = "sim";
  let activeLab = "bloch";
  let walkData = null;
  let walkStage = 0;
  let walkPhase = "idle";
  let walkTimer = null;
  let walkTarget = { x: 0, y: 1, z: 0 };
  let walkDisp = { x: 0, y: 1, z: 0 };
  let walkOrbit = true;

  let propData = null;
  let propFrame = 0;
  let propPhase = "idle";
  let propTimer = null;
  let propOrbit = true;
  let propSpeed = 350;

  // ---------- helpers ----------
  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  }

  function getConfig() {
    const seg = document.querySelector("#inputBitSeg .seg.active");
    return {
      code: $("codeSel").value,
      noise: $("noiseSel").value,
      input_bit: parseInt(seg ? seg.dataset.value : "0", 10),
      probability_percent: parseFloat($("probNum").value),
      shots: parseInt($("shotsNum").value, 10),
      noise_scope: $("scopeSel").value,
      error_qubit: parseInt($("qubitSel").value || "0", 10),
      basis: $("basisSel").value,
    };
  }

  // ============================================================
  // TAB SWITCHING
  // ============================================================

  function showTab(which) {
    activeTab = which;
    $("tabSim").classList.toggle("active", which === "sim");
    $("tab3d").classList.toggle("active", which === "3d");
    $("simPane").hidden = which !== "sim";
    $("pane3d").hidden = which !== "3d";
    if (which === "3d") {
      setTimeout(() => {
        if (activeLab === "bloch") startBloch();
        else startProp();
      }, 50);
    } else {
      stopWalk();
      stopProp();
    }
  }

  function showLab(which) {
    activeLab = which;
    $("labTabBloch").classList.toggle("active", which === "bloch");
    $("labTabProp").classList.toggle("active", which === "prop");
    $("blochCard").hidden = which !== "bloch";
    $("propCard").hidden = which !== "prop";
    if (which === "bloch") { stopProp(); startBloch(); }
    else { stopWalk(); startProp(); }
  }

  // ============================================================
  // A. BLOCH SPHERE WALKTHROUGH
  // ============================================================

  let blochCanvas, blochCtx, blochCam, blochControls;
  let blochRaf = 0, blochLastTime = 0;

  function startBloch() {
    const canvas = $("blochCanvas");
    if (!canvas) return;
    if (!blochControls) {
      blochCanvas = canvas;
      blochControls = E.attachOrbitCam(canvas, { dist: 3.1, yaw: 0.55, pitch: 0.4, auto: true }, wakeBloch);
      blochCam = blochControls.cam;
      blochOrbit = true;
      $("blochOrbit").checked = true;
    }
    if (!walkData) fetchWalkthrough();
    else wakeBloch();
    if (!blochRaf) { blochLastTime = performance.now(); blochRaf = requestAnimationFrame(blochLoop); }
  }

  function wakeBloch() {
    if (!blochRaf) { blochLastTime = performance.now(); blochRaf = requestAnimationFrame(blochLoop); }
  }

  async function fetchWalkthrough() {
    const cfg = getConfig();
    const errType = $("blochErrorType").value || null;
    $("blochStatus").textContent = "Computing 7-stage walkthrough…";
    try {
      const r = await api("/api/3d/walkthrough", { ...cfg, error_type: errType });
      if (!r.ok) throw new Error("backend error");
      walkData = r;
      walkStage = 0;
      walkPhase = "idle";
      walkTarget = { ...r.stages[0].vec };
      walkDisp = { ...r.stages[0].vec };
      updateBlochUI();
      $("blochStatus").textContent = `${r.code_name} · ${r.basis} basis · ready — press Play`;
      wakeBloch();
    } catch (e) {
      $("blochStatus").textContent = "Error: " + (e.message || "unknown");
    }
  }

  function updateBlochUI() {
    if (!walkData) return;
    const s = walkData.stages[walkStage];
    if (!s) return;
    const v = s.vec;
    $("blochStageLabel").textContent = `stage ${walkStage + 1}/7 · ${s.title}`;
    $("blochStageDesc").textContent = s.desc || "";
    $("blochVecReadout").textContent = `|ψ⟩ → (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
    if (s.fidelity !== null && s.fidelity !== undefined) {
      $("blochFidelity").textContent = (s.fidelity * 100).toFixed(1) + "%";
    } else {
      $("blochFidelity").textContent = "—";
    }
    // Syndrome bits
    if (s.syndrome && s.syndrome.length) {
      $("blochSyndrome").innerHTML = s.syndrome.map((sy) =>
        `<div class="lab-syn-row ${sy.bit ? "err" : "ok"}"><span>ancilla ${sy.label}</span><span>${sy.bit}</span></div>`
      ).join("");
    } else {
      $("blochSyndrome").innerHTML = "<div class='lab-syn-row'><span>—</span><span>—</span></div>";
    }
    // Correction
    if (s.correction && (s.correction.x.length || s.correction.z.length)) {
      const parts = [];
      if (s.correction.x.length) parts.push(`X on q${s.correction.x.join(",q")}`);
      if (s.correction.z.length) parts.push(`Z on q${s.correction.z.join(",q")}`);
      $("blochCorrection").textContent = parts.join(" + ");
    } else {
      $("blochCorrection").textContent = "none";
    }
    // Stage pills
    const pills = walkData.stages.map((st, i) =>
      `<span class="stage-pill ${i === walkStage ? "active" : ""} ${i <= walkStage ? "done" : ""}" data-stage="${i}">${i + 1}. ${st.title}</span>`
    ).join("");
    $("blochStagePills").innerHTML = pills;
    // Click handlers
    document.querySelectorAll("#blochStagePills .stage-pill").forEach((el) => {
      el.addEventListener("click", () => goStage(parseInt(el.dataset.stage, 10)));
    });
  }

  function playWalkthrough() {
    if (!walkData) { fetchWalkthrough().then(playWalkthrough); return; }
    walkStage = 0;
    walkPhase = "playing";
    walkTarget = { ...walkData.stages[0].vec };
    $("blochStatus").textContent = "Playing pipeline…";
    if (walkTimer) clearInterval(walkTimer);
    walkTimer = setInterval(() => {
      const next = walkStage + 1;
      if (next >= walkData.stages.length) {
        clearInterval(walkTimer); walkTimer = null;
        walkPhase = "done";
        $("blochStatus").textContent = walkData.success
          ? `✓ Complete — logical state preserved (fidelity ${walkData.stages[walkData.stages.length - 1].fidelity !== null ? (walkData.stages[walkData.stages.length - 1].fidelity * 100).toFixed(1) + "%" : "verified"})`
          : "✗ Complete — logical failure";
        return;
      }
      goStage(next);
    }, 1700);
  }

  function goStage(i) {
    if (!walkData || i < 0 || i >= walkData.stages.length) return;
    walkStage = i;
    walkTarget = { ...walkData.stages[i].vec };
    updateBlochUI();
    wakeBloch();
  }

  function stopWalk() {
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
    walkPhase = "idle";
  }

  function resetWalk() {
    stopWalk();
    walkStage = 0;
    if (walkData) {
      walkTarget = { ...walkData.stages[0].vec };
      walkDisp = { ...walkData.stages[0].vec };
      updateBlochUI();
      $("blochStatus").textContent = "Reset — press Play";
    }
    wakeBloch();
  }

  function blochLoop() {
    const cv = blochCanvas;
    if (!cv) { blochRaf = 0; return; }
    const fit = E.fitCanvas(cv);
    if (!fit) { blochRaf = 0; return; }
    const { w, h, ctx } = fit;
    const now = performance.now();
    const dt = Math.min(0.1, (now - blochLastTime) / 1000);
    blochLastTime = now;

    // Auto-orbit
    if (blochCam.auto) blochCam.yaw += dt * 0.12;

    // Eased arrow
    const ease = 1 - Math.exp(-dt * 5);
    walkDisp = {
      x: walkDisp.x + (walkTarget.x - walkDisp.x) * ease,
      y: walkDisp.y + (walkTarget.y - walkDisp.y) * ease,
      z: walkDisp.z + (walkTarget.z - walkDisp.z) * ease,
    };

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.48;
    const scale = Math.min(w, h) * 0.36;

    // Wireframe sphere
    E.drawWireSphere(ctx, blochCam, cx, cy, scale, "rgba(134,126,205,0.62)");

    // Axes + labels
    const axes = [
      { v: { x: 0, y: 1.18, z: 0 }, label: "|0⟩" },
      { v: { x: 0, y: -1.18, z: 0 }, label: "|1⟩" },
      { v: { x: 1.2, y: 0, z: 0 }, label: "|+⟩" },
      { v: { x: -1.2, y: 0, z: 0 }, label: "|−⟩" },
      { v: { x: 0, y: 0, z: 1.2 }, label: "|+i⟩" },
      { v: { x: 0, y: 0, z: -1.2 }, label: "|−i⟩" },
    ];
    for (const ax of axes) {
      E.stroke3D(ctx, [{ x: 0, y: 0, z: 0 }, ax.v], blochCam, cx, cy, scale, "rgba(100,90,150,0.4)", 0.8, [3, 3]);
      E.label3D(ctx, ax.label, ax.v, blochCam, cx, cy, scale, "#8b85ad", "10px monospace", 0, 0);
    }

    // Target pin (the requested input state)
    if (walkData) {
      const t = walkData.target_vec;
      E.dot3D(ctx, t, blochCam, cx, cy, scale, "rgba(103,232,249,0.28)", 9, 0);
      E.dot3D(ctx, t, blochCam, cx, cy, scale, "rgba(103,232,249,0.95)", 3, 10);
      E.label3D(ctx, "target |ψ⟩", { x: t.x * 1.16, y: t.y * 1.16, z: t.z * 1.16 },
                blochCam, cx, cy, scale, "rgba(103,232,249,0.95)", "10px ui-sans-serif", 6, -6);
    }

    // State arrow
    E.drawArrow3D(ctx, walkDisp, blochCam, cx, cy, scale, "#a78bfa", 3.2);

    // Stage caption
    ctx.save();
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillStyle = "rgba(226,232,240,0.92)";
    if (walkData && walkData.stages[walkStage]) {
      ctx.fillText(`stage ${walkStage + 1}/7 · ${walkData.stages[walkStage].title}`, 14, 24);
    }
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(167,139,250,1)";
    ctx.fillText("— logical qubit state (live)", 14, 42);
    ctx.restore();

    // Badge
    ctx.save();
    ctx.fillStyle = "rgba(139,92,246,0.25)";
    ctx.strokeStyle = "rgba(167,139,250,0.5)";
    ctx.lineWidth = 1;
    const badgeW = 110, badgeH = 22;
    ctx.beginPath();
    // roundRect fallback (not all browsers support ctx.roundRect)
    const bx = w - badgeW - 14, by = 14, br = 11;
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + badgeW - br, by);
    ctx.arcTo(bx + badgeW, by, bx + badgeW, by + br, br);
    ctx.lineTo(bx + badgeW, by + badgeH - br);
    ctx.arcTo(bx + badgeW, by + badgeH, bx + badgeW - br, by + badgeH, br);
    ctx.lineTo(bx + br, by + badgeH);
    ctx.arcTo(bx, by + badgeH, bx, by + badgeH - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ddd6fe";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("3D · live pipeline", w - badgeW / 2 - 14, 29);
    ctx.restore();

    // Continue animating?
    const settled =
      Math.abs(walkDisp.x - walkTarget.x) < 0.004 &&
      Math.abs(walkDisp.y - walkTarget.y) < 0.004 &&
      Math.abs(walkDisp.z - walkTarget.z) < 0.004;
    const keep = walkPhase === "playing" || !settled || blochCam.auto;
    if (keep) {
      blochRaf = requestAnimationFrame(blochLoop);
    } else {
      blochRaf = 0;
    }
  }

  // ============================================================
  // B. 3D CIRCUIT & ERROR PROPAGATION
  // ============================================================

  let propCanvas, propCtx, propCam, propControls;
  let propRaf = 0, propLastTime = 0;
  let propCursor = 0;

  function startProp() {
    const canvas = $("propCanvas");
    if (!canvas) return;
    if (!propControls) {
      propCanvas = canvas;
      propControls = E.attachOrbitCam(canvas, { dist: 7.2, yaw: 0.9, pitch: 0.5, auto: true }, wakeProp);
      propCam = propControls.cam;
      propOrbit = true;
      $("propOrbit").checked = true;
    }
    if (!propData) fetchPropCircuit();
    else wakeProp();
    if (!propRaf) { propLastTime = performance.now(); propRaf = requestAnimationFrame(propLoop); }
  }

  function wakeProp() {
    if (!propRaf) { propLastTime = performance.now(); propRaf = requestAnimationFrame(propLoop); }
  }

  async function fetchPropCircuit() {
    const cfg = getConfig();
    $("propStatus").textContent = "Building 3D circuit…";
    try {
      const r = await api("/api/3d/circuit", cfg);
      if (!r.ok) throw new Error("backend error");
      propData = r;
      propFrame = 0;
      propPhase = "idle";
      $("propChips").innerHTML = [
        `${r.n_total_qubits} qubits`, `${r.n_columns} gates`, r.code_name, r.basis + " basis",
      ].map((t) => `<span class="chip">${t}</span>`).join("");
      $("propStatus").textContent = `${r.code_name} · ${r.n_total_qubits} qubits · ${r.n_columns} gates — press Play`;
      wakeProp();
    } catch (e) {
      $("propStatus").textContent = "Error: " + (e.message || "unknown");
    }
  }

  async function playProp() {
    if (!propData) { await fetchPropCircuit(); }
    if (!propData) return;
    const cfg = getConfig();
    const errType = $("propErrorType").value || null;
    $("propStatus").textContent = "Propagating error…";
    try {
      const r = await api("/api/3d/propagate", { ...cfg, error_type: errType });
      if (!r.ok) throw new Error("backend error");
      propData.frames = r.frames;
      propData.propResult = r;
      propFrame = 0;
      propCursor = 0;
      propPhase = "playing";
      $("propStatus").textContent = `Playing ${r.n_frames} frames · injected ${r.error_type} on q${r.error_qubit}`;
      animateProp();
    } catch (e) {
      $("propStatus").textContent = "Error: " + (e.message || "unknown");
    }
  }

  function animateProp() {
    if (!propData || !propData.frames) return;
    stopProp();
    const frames = propData.frames;
    const t0 = performance.now();
    const dur = 2600;
    const tick = () => {
      const frac = Math.min(1, (performance.now() - t0) / dur);
      propCursor = frac;
      propFrame = Math.min(Math.floor(frac * frames.length), frames.length - 1);
      wakeProp();
      if (frac < 1) {
        propTimer = setTimeout(tick, propSpeed / 3);
      } else {
        propPhase = "done";
        const r = propData.propResult;
        const finalStr = Object.keys(r.final_errors).length
          ? "Final: " + Object.entries(r.final_errors).map(([q, p]) => `q${q}=${p}`).join(", ")
          : "Final: no Pauli error remains on the data qubits";
        const statusIcon = r.logical_success === true ? "✓" : r.logical_success === false ? "✗" : "?";
        const statusText = r.logical_success === true
          ? `${statusIcon} Logically corrected · ${finalStr}`
          : r.logical_success === false
          ? `${statusIcon} Logical failure · ${finalStr}`
          : `${statusIcon} ${finalStr}`;
        $("propStatus").textContent = statusText;
        $("propFrameInfo").textContent = `Done. ${r.n_frames} frames played. ${finalStr}`;
      }
    };
    tick();
  }

  function stopProp() {
    if (propTimer) { clearTimeout(propTimer); propTimer = null; }
  }

  function stepProp() {
    if (!propData || !propData.frames) { playProp().then(() => { stopProp(); }); return; }
    stopProp();
    if (propFrame >= propData.frames.length - 1) propFrame = 0;
    else propFrame += 1;
    propCursor = propFrame / propData.frames.length;
    propPhase = "done";
    wakeProp();
  }

  function resetProp() {
    stopProp();
    propFrame = 0;
    propCursor = 0;
    propPhase = "idle";
    $("propStatus").textContent = "Reset — press Play";
    $("propFrameInfo").textContent = "Press Play to inject a Pauli error and watch it propagate.";
    wakeProp();
  }

  function propLoop() {
    const cv = propCanvas;
    if (!cv) { propRaf = 0; return; }
    const fit = E.fitCanvas(cv);
    if (!fit) { propRaf = 0; return; }
    const { w, h, ctx } = fit;
    const now = performance.now();
    const dt = Math.min(0.1, (now - propLastTime) / 1000);
    propLastTime = now;

    if (propCam.auto) propCam.yaw += dt * 0.12;
    ctx.clearRect(0, 0, w, h);

    if (!propData) { propRaf = 0; return; }

    const nQ = propData.n_total_qubits;
    const nCols = propData.n_columns;
    const RAIL_SPACING = 0.52;
    const RAIL_HALF = 2.6;
    const cx = w / 2, cy = h * 0.5;
    const scale = Math.min(w / 7.9, h / 5.15);
    const railY = (q) => (q - (nQ - 1) / 2) * RAIL_SPACING;

    // Floor grid hint
    for (let gx = -RAIL_HALF; gx <= RAIL_HALF + 0.01; gx += RAIL_HALF / 2) {
      E.stroke3D(ctx, [
        { x: gx, y: -(nQ / 2) * RAIL_SPACING - 0.35, z: -0.7 },
        { x: gx, y: -(nQ / 2) * RAIL_SPACING - 0.35, z: 0.7 },
      ], propCam, cx, cy, scale, "rgba(90,80,150,0.14)", 1);
    }

    // Rails (qubit wires)
    for (let q = 0; q < nQ; q++) {
      const y = railY(q);
      const isAncilla = q >= propData.n_data_qubits;
      E.stroke3D(ctx, [
        { x: -RAIL_HALF - 0.25, y, z: 0 },
        { x: RAIL_HALF + 0.25, y, z: 0 },
      ], propCam, cx, cy, scale, isAncilla ? "rgba(148,120,220,0.35)" : "rgba(148,120,220,0.65)", isAncilla ? 1.2 : 2);
      E.label3D(ctx, `q${q}`, { x: -RAIL_HALF - 0.32, y, z: 0 }, propCam, cx, cy, scale,
                isAncilla ? "#8f9bc7" : "#c4b5fd", "12px ui-monospace, monospace", -30, 4);
    }

    // Gates
    const gateX = [];
    for (let i = 0; i < nCols; i++) gateX.push(-RAIL_HALF + ((i + 0.5) / nCols) * 2 * RAIL_HALF);

    propData.columns.forEach((col, gi) => {
      const x = gateX[gi];
      const passed = propCursor * nCols > gi;
      if (col.is_noise) {
        // Noise marker — red sphere
        const q = col.qubits[0];
        E.dot3D(ctx, { x, y: railY(q), z: 0 }, propCam, cx, cy, scale,
                passed ? "#ff6b81" : "rgba(255,107,129,0.5)", 7, passed ? 15 : 5);
        E.label3D(ctx, "I", { x, y: railY(q) + 0.2, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#ffd3da" : "rgba(255,211,218,0.5)", "bold 10px monospace", 0, 0);
      } else if (col.is_measure) {
        const q = col.qubits[0];
        E.bar3D(ctx, { x, z: 0 }, railY(q) - 0.14, railY(q) + 0.14, 0.12, propCam, cx, cy, scale,
                passed ? "#3ddc97" : "rgba(61,220,151,0.4)", { outline: passed ? "#c9f5e2" : "rgba(201,245,226,0.4)" });
        E.label3D(ctx, "M", { x, y: railY(q) + 0.3, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#c9f5e2" : "rgba(201,245,226,0.5)", "bold 10px monospace", 0, 0);
      } else if (col.name === "cx" && col.qubits.length === 2) {
        const [c, t] = col.qubits;
        const y1 = railY(c), y2 = railY(t);
        E.stroke3D(ctx, [{ x, y: y1, z: 0 }, { x, y: y2, z: 0 }], propCam, cx, cy, scale,
                   passed ? "#67e8f9" : "rgba(103,232,249,0.5)", passed ? 2.4 : 1.4);
        E.dot3D(ctx, { x, y: y1, z: 0 }, propCam, cx, cy, scale,
                passed ? "#67e8f9" : "rgba(103,232,249,0.55)", 4.6, passed ? 11 : 5);
        E.dot3D(ctx, { x, y: y2, z: 0 }, propCam, cx, cy, scale,
                passed ? "#22d3ee" : "rgba(34,211,238,0.55)", 6.4, passed ? 13 : 6);
        E.label3D(ctx, "CNOT", { x, y: (y1 + y2) / 2, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#a5f3fc" : "rgba(165,243,252,0.55)", "9px ui-sans-serif", 7, -2);
      } else if (col.is_correction) {
        const q = col.qubits[0];
        E.bar3D(ctx, { x, z: 0 }, railY(q) - 0.16, railY(q) + 0.16, 0.14, propCam, cx, cy, scale,
                passed ? "#ffc857" : "rgba(255,200,87,0.4)", { outline: passed ? "#fff0c2" : "rgba(255,240,194,0.4)" });
        E.label3D(ctx, "if", { x, y: railY(q) + 0.34, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#fff0c2" : "rgba(255,240,194,0.5)", "bold 10px monospace", 0, 0);
      } else if (col.name === "h") {
        const q = col.qubits[0];
        E.bar3D(ctx, { x, z: 0 }, railY(q) - 0.16, railY(q) + 0.16, 0.14, propCam, cx, cy, scale,
                passed ? "#8b5cf6" : "#4c3a80", { outline: passed ? "#c4b5fd" : "rgba(196,181,253,0.5)" });
        E.label3D(ctx, "H", { x, y: railY(q) + 0.34, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#ddd6fe" : "rgba(221,214,254,0.6)", "bold 11px monospace", 0, 0);
      } else if (col.name === "x" || col.name === "y" || col.name === "z") {
        const q = col.qubits[0];
        E.bar3D(ctx, { x, z: 0 }, railY(q) - 0.16, railY(q) + 0.16, 0.14, propCam, cx, cy, scale,
                passed ? "#5b8cff" : "rgba(91,140,255,0.4)", { outline: passed ? "#c4d4ff" : "rgba(196,212,255,0.4)" });
        E.label3D(ctx, col.name.toUpperCase(), { x, y: railY(q) + 0.34, z: 0 }, propCam, cx, cy, scale,
                  passed ? "#c4d4ff" : "rgba(196,212,255,0.5)", "bold 11px monospace", 0, 0);
      }
    });

    // Error markers — the current frame
    if (propData.frames && propPhase !== "idle") {
      const frame = propData.frames[propFrame] || propData.frames[propData.frames.length - 1];
      if (frame && frame.paulis) {
        const pulseX = -RAIL_HALF - 0.05 + propCursor * 2 * RAIL_HALF;
        for (let q = 0; q < nQ; q++) {
          const p = frame.paulis[String(q)] || frame.paulis[q] || "I";
          if (p && p !== "I") {
            const color = PAULI_COLOR[p] || PAULI_COLOR.I;
            const y = railY(q);
            E.dot3D(ctx, { x: pulseX, y, z: 0 }, propCam, cx, cy, scale, color, 8, 18);
            E.label3D(ctx, p, { x: pulseX, y: y + 0.17, z: 0 }, propCam, cx, cy, scale,
                      color, "bold 12px ui-monospace, monospace", 8, -8);
          }
        }
      }
    }

    // Output frame halos (when done)
    if (propData.frames && propPhase === "done") {
      const r = propData.propResult;
      if (r && r.final_errors) {
        for (const [q, p] of Object.entries(r.final_errors)) {
          if (p === "I") continue;
          const color = PAULI_COLOR[p] || PAULI_COLOR.I;
          const qi = parseInt(q, 10);
          E.dot3D(ctx, { x: RAIL_HALF + 0.3, y: railY(qi), z: 0 }, propCam, cx, cy, scale, color, 9, 22);
        }
        if (Object.keys(r.final_errors).length > 0) {
          E.label3D(ctx, "output frame", { x: RAIL_HALF + 0.3, y: railY(nQ - 1) + 0.45, z: 0 },
                    propCam, cx, cy, scale, "#94a3b8", "10px ui-sans-serif", -30, 0);
        }
      }
    }

    // Caption
    ctx.save();
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillStyle = "rgba(226,232,240,0.92)";
    let caption = "";
    if (propPhase === "idle") {
      caption = `idle — press Play to propagate`;
    } else if (propPhase === "playing") {
      caption = `propagating… gate ${propFrame + 1}/${propData.frames ? propData.frames.length : nCols}`;
    } else if (propPhase === "done" && propData.propResult) {
      const r = propData.propResult;
      const parts = [];
      for (const [q, p] of Object.entries(r.final_errors)) {
        if (p !== "I") parts.push(`${p}@q${q}`);
      }
      caption = `complete — output: ${parts.length ? parts.join(" · ") : "clean (identity)"}`;
    }
    ctx.fillText(caption, 14, 24);
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillStyle = "rgba(167,139,250,1)";
    ctx.fillText(`${propData.code_name} encoding circuit · ${nCols} gates — errors SPLIT and MORPH as they cross gates`, 14, 42);
    ctx.restore();

    // Badge
    ctx.save();
    ctx.fillStyle = "rgba(139,92,246,0.25)";
    ctx.strokeStyle = "rgba(167,139,250,0.5)";
    ctx.lineWidth = 1;
    const badgeW = 130, badgeH = 22;
    ctx.beginPath();
    const bx = w - badgeW - 14, by = 14, br = 11;
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + badgeW - br, by);
    ctx.arcTo(bx + badgeW, by, bx + badgeW, by + br, br);
    ctx.lineTo(bx + badgeW, by + badgeH - br);
    ctx.arcTo(bx + badgeW, by + badgeH, bx + badgeW - br, by + badgeH, br);
    ctx.lineTo(bx + br, by + badgeH);
    ctx.arcTo(bx, by + badgeH, bx, by + badgeH - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ddd6fe";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("3D · live propagation", w - badgeW / 2 - 14, 29);
    ctx.restore();

    // Legend (top-left)
    ctx.save();
    ctx.font = "10px ui-sans-serif, system-ui";
    const legends = [
      { color: "#fb7185", label: "X (bit flip)" },
      { color: "#fbbf24", label: "Z (phase flip)" },
      { color: "#e879f9", label: "Y (both)" },
    ];
    legends.forEach((lg, i) => {
      const y = 60 + i * 16;
      ctx.fillStyle = lg.color;
      ctx.beginPath(); ctx.arc(18, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(226,232,240,0.7)";
      ctx.textAlign = "left";
      ctx.fillText(lg.label, 28, y + 3);
    });
    ctx.restore();

    // Frame info
    if (propData.frames && propPhase !== "idle") {
      const frame = propData.frames[propFrame] || propData.frames[propData.frames.length - 1];
      if (frame) {
        $("propFrameInfo").textContent =
          `Frame ${propFrame + 1} / ${propData.frames.length} · gate: ${frame.gate} · qubits: q[${frame.active_qubits.join(", ")}] · ${frame.label || ""}`;
        // Syndrome
        if (frame.syndrome && Object.keys(frame.syndrome).length) {
          $("propSyndrome").innerHTML = Object.entries(frame.syndrome).map(([a, v]) =>
            `<div class="lab-syn-row ${v ? "err" : "ok"}"><span>ancilla q${a}</span><span>${v}</span></div>`
          ).join("");
        } else {
          $("propSyndrome").innerHTML = "<div class='lab-syn-row'><span>—</span><span>—</span></div>";
        }
      }
    }

    const keep = propPhase === "playing" || propCam.auto;
    if (keep) propRaf = requestAnimationFrame(propLoop);
    else propRaf = 0;
  }

  // ============================================================
  // EXPORT FUNCTIONS
  // ============================================================

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  function teamNames() {
    return "K. Devendra Reddy · Shaik Muzzammil · D. Guna Samhith";
  }

  function exportBlochReport() {
    if (!walkData) { alert("Press Play first to generate walkthrough data."); return; }
    const cfg = getConfig();
    const w = window.open("", "_blank");
    if (!w) return;
    const stages = walkData.stages;
    const stageRows = stages.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${s.title}</strong></td>
        <td>${s.desc || ""}</td>
        <td>(${s.vec.x.toFixed(3)}, ${s.vec.y.toFixed(3)}, ${s.vec.z.toFixed(3)})</td>
        <td>${s.fidelity !== null && s.fidelity !== undefined ? (s.fidelity * 100).toFixed(1) + "%" : "—"}</td>
        <td>${s.correction.x.length ? "X on q" + s.correction.x.join(",q") : ""}${s.correction.z.length ? (s.correction.x.length ? " + " : "") + "Z on q" + s.correction.z.join(",q") : ""}</td>
        <td>${s.syndrome.map((sy) => `${sy.label}=${sy.bit}`).join(", ") || "—"}</td>
      </tr>`).join("");

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>3D Bloch Sphere — Pipeline Walkthrough Report</title>
      <style>
        body { font-family: "Manrope", sans-serif; background: #0a0f1f; color: #e8ecff; margin: 40px; }
        h1 { color: #a78bfa; border-bottom: 2px solid #5b8cff; padding-bottom: 10px; }
        h2 { color: #c9d3ff; margin-top: 30px; }
        .header { background: #111a33; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #243257; }
        .header table { width: 100%; border-collapse: collapse; }
        .header td { padding: 4px 12px; color: #bfc9f3; }
        .header td:first-child { color: #8f9bc7; font-weight: 600; width: 200px; }
        table.data { width: 100%; border-collapse: collapse; margin: 10px 0; }
        table.data th { background: #172345; color: #c9d3ff; padding: 8px 10px; text-align: left; font-size: 12px; border-bottom: 2px solid #5b8cff; }
        table.data td { padding: 8px 10px; border-bottom: 1px solid #243257; font-size: 12px; vertical-align: top; }
        .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #243257; color: #8f9bc7; font-size: 11px; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: linear-gradient(135deg, #8b6cff, #5b8cff); color: #fff; font-size: 10px; font-weight: 700; }
        .success { color: #3ddc97; font-weight: 700; }
        .fail { color: #ff6b81; font-weight: 700; }
      </style></head><body>
      <h1>3D Bloch Sphere — Pipeline Walkthrough Report <span class="badge">3D Lab</span></h1>
      <div class="header">
        <table>
          <tr><td>QEC Code</td><td>${walkData.code_name}</td></tr>
          <tr><td>Input bit</td><td>|${walkData.input_bit}⟩</td></tr>
          <tr><td>Error type</td><td>${walkData.error_type} on q${walkData.error_qubit}</td></tr>
          <tr><td>Logical basis</td><td>${walkData.basis}</td></tr>
          <tr><td>Target state</td><td>(${walkData.target_vec.x.toFixed(2)}, ${walkData.target_vec.y.toFixed(2)}, ${walkData.target_vec.z.toFixed(2)})</td></tr>
          <tr><td>Logical result</td><td class="${walkData.success ? "success" : "fail"}">${walkData.logical_success === true ? "✓ CORRECTED (logical state preserved)" : walkData.logical_success === false ? "✗ FAILED (logical state lost)" : "—"}</td></tr>
          <tr><td>Generated at</td><td>${nowStamp()}</td></tr>
        </table>
      </div>
      <h2>7-Stage Pipeline Walkthrough</h2>
      <p>Each stage's Bloch vector is computed by the real Qiskit state-vector engine (decode + partial trace + Bloch projection).</p>
      <table class="data">
        <thead><tr>
          <th>#</th><th>Stage</th><th>Description</th><th>Bloch Vector (x, y, z)</th><th>Fidelity</th><th>Correction</th><th>Syndrome</th>
        </tr></thead>
        <tbody>${stageRows}</tbody>
      </table>
      <h2>The Quantum Circuit</h2>
      <p>The QEC circuit built by <code>qec_simulator.py</code> for ${walkData.code_name}:</p>
      <pre style="background: #060917; padding: 16px; border-radius: 8px; overflow-x: auto; color: #dfe6ff; font-family: monospace; font-size: 11px; border: 1px solid #243257;">${(window.circuitText || "Circuit text available in the Simulator tab.").replace(/</g, "&lt;")}</pre>
      <div class="footer">
        <strong>Interactive Quantum Error Correction Simulator</strong> — 3D Simulator Lab · Bloch Sphere Walkthrough<br>
        Generated at ${nowStamp()} · Team: ${teamNames()}<br>
        Every Bloch vector is a real Qiskit Statevector computation — no mock data.
      </div>
      </body></html>`);
    w.document.close();
  }

  function exportBlochJSON() {
    if (!walkData) { alert("Press Play first."); return; }
    const data = {
      experiment: "3D Bloch Sphere — Pipeline Walkthrough",
      generatedAt: nowStamp(),
      team: teamNames(),
      inputs: {
        code: walkData.code_name,
        input_bit: walkData.input_bit,
        error_type: walkData.error_type,
        error_qubit: walkData.error_qubit,
        basis: walkData.basis,
        target_vec: walkData.target_vec,
      },
      stages: walkData.stages,
      logical_success: walkData.logical_success,
    };
    downloadFile(`bloch_walkthrough_${walkData.code}_${nowStamp()}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  function exportBlochCSV() {
    if (!walkData) { alert("Press Play first."); return; }
    const header = "stage,title,description,bloch_x,bloch_y,bloch_z,fidelity,correction_x,correction_z,syndrome\n";
    const rows = walkData.stages.map((s) => {
      const fid = s.fidelity !== null && s.fidelity !== undefined ? s.fidelity.toFixed(4) : "";
      const cx = s.correction.x.length ? `q${s.correction.x.join(";q")}` : "";
      const cz = s.correction.z.length ? `q${s.correction.z.join(";q")}` : "";
      const syn = s.syndrome.map((sy) => `${sy.label}=${sy.bit}`).join(";");
      return [s.key, s.title, `"${(s.desc || "").replace(/"/g, '""')}"`, s.vec.x.toFixed(4), s.vec.y.toFixed(4), s.vec.z.toFixed(4), fid, `"${cx}"`, `"${cz}"`, `"${syn}"`].join(",");
    }).join("\n");
    downloadFile(`bloch_walkthrough_${walkData.code}_${nowStamp()}.csv`, header + rows, "text/csv");
  }

  function exportPropReport() {
    if (!propData || !propData.propResult) { alert("Press Play first to run the propagation."); return; }
    const r = propData.propResult;
    const w = window.open("", "_blank");
    if (!w) return;
    const frameRows = r.frames.map((f, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${f.gate}</td>
        <td>q[${f.active_qubits.join(", ")}]</td>
        <td>${f.label || ""}</td>
        <td>${Object.entries(f.paulis || {}).filter(([_, p]) => p && p !== "I").map(([q, p]) => `${p}@q${q}`).join(" · ") || "clean"}</td>
        <td>${Object.entries(f.syndrome || {}).map(([a, v]) => `q${a}=${v}`).join(", ") || "—"}</td>
      </tr>`).join("");

    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>3D Circuit & Error Propagation Report</title>
      <style>
        body { font-family: "Manrope", sans-serif; background: #0a0f1f; color: #e8ecff; margin: 40px; }
        h1 { color: #a78bfa; border-bottom: 2px solid #5b8cff; padding-bottom: 10px; }
        h2 { color: #c9d3ff; margin-top: 30px; }
        .header { background: #111a33; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #243257; }
        .header table { width: 100%; border-collapse: collapse; }
        .header td { padding: 4px 12px; color: #bfc9f3; }
        .header td:first-child { color: #8f9bc7; font-weight: 600; width: 200px; }
        table.data { width: 100%; border-collapse: collapse; margin: 10px 0; }
        table.data th { background: #172345; color: #c9d3ff; padding: 8px 10px; text-align: left; font-size: 12px; border-bottom: 2px solid #5b8cff; }
        table.data td { padding: 8px 10px; border-bottom: 1px solid #243257; font-size: 12px; vertical-align: top; font-family: monospace; }
        .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #243257; color: #8f9bc7; font-size: 11px; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; background: linear-gradient(135deg, #8b6cff, #5b8cff); color: #fff; font-size: 10px; font-weight: 700; }
        .success { color: #3ddc97; font-weight: 700; }
        .fail { color: #ff6b81; font-weight: 700; }
        .legend { display: flex; gap: 20px; margin: 10px 0; font-size: 12px; }
        .legend span { display: inline-flex; align-items: center; gap: 6px; }
        .dot { width: 12px; height: 12px; border-radius: 50%; }
      </style></head><body>
      <h1>3D Circuit & Error Propagation Report <span class="badge">3D Lab</span></h1>
      <div class="header">
        <table>
          <tr><td>QEC Code</td><td>${r.code_name}</td></tr>
          <tr><td>Input bit</td><td>|${r.input_bit}⟩</td></tr>
          <tr><td>Injected error</td><td>${r.error_type} on q${r.error_qubit}</td></tr>
          <tr><td>Noise scope</td><td>${r.noise_scope}</td></tr>
          <tr><td>Logical basis</td><td>${r.basis}</td></tr>
          <tr><td>Total frames</td><td>${r.n_frames}</td></tr>
          <tr><td>Final errors</td><td>${Object.keys(r.final_errors).length ? Object.entries(r.final_errors).map(([q, p]) => `${p}@q${q}`).join(" · ") : "clean (identity)"}</td></tr>
          <tr><td>Logical result</td><td class="${r.logical_success === true ? "success" : "fail"}">${r.logical_success === true ? "✓ CORRECTED (logical state preserved)" : r.logical_success === false ? "✗ FAILED" : "—"}</td></tr>
          <tr><td>Generated at</td><td>${nowStamp()}</td></tr>
        </table>
      </div>
      <h2>Error Propagation Ledger</h2>
      <p>The Pauli frame is pushed through every Clifford gate using exact conjugation rules: X through CNOT control → target; Z through CNOT target → control; H swaps X↔Z.</p>
      <div class="legend">
        <span><span class="dot" style="background:#fb7185"></span> X (bit flip)</span>
        <span><span class="dot" style="background:#fbbf24"></span> Z (phase flip)</span>
        <span><span class="dot" style="background:#e879f9"></span> Y (both)</span>
      </div>
      <table class="data">
        <thead><tr>
          <th>#</th><th>Gate</th><th>Qubits</th><th>Step Label</th><th>Errors Present (Pauli frame)</th><th>Syndrome</th>
        </tr></thead>
        <tbody>${frameRows}</tbody>
      </table>
      <h2>The Quantum Circuit</h2>
      <pre style="background: #060917; padding: 16px; border-radius: 8px; overflow-x: auto; color: #dfe6ff; font-family: monospace; font-size: 11px; border: 1px solid #243257;">${(window.circuitText || "Circuit text available in the Simulator tab.").replace(/</g, "&lt;")}</pre>
      <div class="footer">
        <strong>Interactive Quantum Error Correction Simulator</strong> — 3D Simulator Lab · Circuit & Error Propagation<br>
        Generated at ${nowStamp()} · Team: ${teamNames()}<br>
        Every frame is computed by the real Qiskit state-vector engine using exact Clifford conjugation rules.
      </div>
      </body></html>`);
    w.document.close();
  }

  function exportPropJSON() {
    if (!propData || !propData.propResult) { alert("Press Play first."); return; }
    const r = propData.propResult;
    const data = {
      experiment: "3D Circuit & Error Propagation",
      generatedAt: nowStamp(),
      team: teamNames(),
      inputs: { code: r.code_name, input_bit: r.input_bit, error_type: r.error_type, error_qubit: r.error_qubit, noise_scope: r.noise_scope, basis: r.basis },
      n_frames: r.n_frames,
      frames: r.frames,
      final_errors: r.final_errors,
      logical_success: r.logical_success,
    };
    downloadFile(`error_propagation_${r.code}_${nowStamp()}.json`, JSON.stringify(data, null, 2), "application/json");
  }

  function exportPropCSV() {
    if (!propData || !propData.propResult) { alert("Press Play first."); return; }
    const r = propData.propResult;
    const header = "frame,gate,qubits,label,errors,syndrome\n";
    const rows = r.frames.map((f, i) => {
      const errs = Object.entries(f.paulis || {}).filter(([_, p]) => p && p !== "I").map(([q, p]) => `${p}@q${q}`).join(";");
      const syn = Object.entries(f.syndrome || {}).map(([a, v]) => `q${a}=${v}`).join(";");
      return [i + 1, f.gate, `"q[${f.active_qubits.join(",")}]"`, `"${(f.label || "").replace(/"/g, '""')}"`, `"${errs}"`, `"${syn}"`].join(",");
    }).join("\n");
    downloadFile(`error_propagation_${r.code}_${nowStamp()}.csv`, header + rows, "text/csv");
  }

  async function exportPropCircuit() {
    if (!propData) { alert("Load the circuit first."); return; }
    const cfg = getConfig();
    try {
      const r = await api("/api/circuit", cfg);
      if (r.ok) {
        downloadFile(`circuit_${cfg.code}_${nowStamp()}.txt`, r.circuit, "text/plain");
      }
    } catch (e) {
      alert("Could not export circuit: " + e.message);
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    // Top tabs
    $("tabSim").addEventListener("click", () => showTab("sim"));
    $("tab3d").addEventListener("click", () => showTab("3d"));

    // Lab sub-tabs
    $("labTabBloch").addEventListener("click", () => showLab("bloch"));
    $("labTabProp").addEventListener("click", () => showLab("prop"));

    // Bloch controls
    $("blochPlay").addEventListener("click", playWalkthrough);
    $("blochReset").addEventListener("click", resetWalk);
    $("blochErrorType").addEventListener("change", () => { walkData = null; fetchWalkthrough(); });

    // Bloch export buttons
    $("blochExportReport").addEventListener("click", exportBlochReport);
    $("blochExportJSON").addEventListener("click", exportBlochJSON);
    $("blochExportCSV").addEventListener("click", exportBlochCSV);

    // Prop controls
    $("propPlay").addEventListener("click", playProp);
    $("propStep").addEventListener("click", stepProp);
    $("propReset").addEventListener("click", resetProp);
    $("propSpeed").addEventListener("change", (e) => { propSpeed = parseInt(e.target.value, 10); });

    // Prop export buttons
    $("propExportReport").addEventListener("click", exportPropReport);
    $("propExportJSON").addEventListener("click", exportPropJSON);
    $("propExportCSV").addEventListener("click", exportPropCSV);
    $("propExportCircuit").addEventListener("click", exportPropCircuit);

    // Orbit toggles
    $("blochOrbit").addEventListener("change", (e) => {
      blochOrbit = e.target.checked;
      if (blochControls) blochControls.setAuto(blochOrbit);
      wakeBloch();
    });
    $("propOrbit").addEventListener("change", (e) => {
      propOrbit = e.target.checked;
      if (propControls) propControls.setAuto(propOrbit);
      wakeProp();
    });

    // React to config panel changes
    const onChange = () => {
      if (activeTab !== "3d") return;
      walkData = null;
      propData = null;
      if (activeLab === "bloch") fetchWalkthrough();
      else fetchPropCircuit();
    };
    ["codeSel", "noiseSel", "scopeSel", "qubitSel", "basisSel"].forEach((id) =>
      $(id).addEventListener("change", onChange));
    $("inputBitSeg").addEventListener("click", () => setTimeout(onChange, 50));
    $("probRange").addEventListener("input", onChange);
    $("probNum").addEventListener("input", onChange);

    // Default: show simulator tab
    showTab("sim");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
