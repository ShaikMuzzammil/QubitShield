/* 3d_engine.js — Minimal high-performance 3D engine for the QEC visualizers.
 * Pure Canvas-2D rendering with perspective projection, painter sorting and
 * an orbit camera (drag to rotate, wheel/pinch to zoom) — zero dependencies.
 *
 * Ported from the reference project's three-d.ts. Provides:
 *   - OrbitCam: drag to rotate, wheel to zoom, optional auto-orbit
 *   - proj(): perspective projection from world (y = up) to screen
 *   - fitCanvas(): DPR-aware resize
 *   - stroke3D, quad3D, bar3D, drawWireSphere, drawArrow3D, dot3D, label3D
 *   - drawFloorGrid, star3D, shade, tint
 *
 * Convention: world coordinates have y pointing UP. The Bloch sphere has
 * |0⟩ at +y, |+⟩ at +x, |+i⟩ at +z. The circuit has qubits as horizontal
 * rails (x = time, y = qubit index), depth into the screen via z.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* -------------------------------------------------------------------- */
  /* Orbit camera                                                          */
  /* -------------------------------------------------------------------- */

  function makeCam(initial) {
    return {
      yaw: initial?.yaw ?? 0.6,
      pitch: initial?.pitch ?? 0.42,
      dist: initial?.dist ?? 3.2,
      auto: initial?.auto ?? false,
    };
  }

  /**
   * Attach orbit camera controls to a canvas element.
   * Returns { cam, setAuto, destroy }.
   */
  function attachOrbitCam(canvas, initial, onUserMove) {
    const cam = makeCam(initial);
    const drag = { on: false, px: 0, py: 0 };

    function onPointerDown(e) {
      drag.on = true; drag.px = e.clientX; drag.py = e.clientY;
      try { canvas.setPointerCapture?.(e.pointerId); } catch (_) {}
      cam.auto = false;
    }
    function onPointerMove(e) {
      if (!drag.on) return;
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      drag.px = e.clientX; drag.py = e.clientY;
      cam.yaw += dx * 0.0085;
      cam.pitch = clamp(cam.pitch + dy * 0.006, -1.35, 1.35);
      if (onUserMove) onUserMove();
    }
    function endDrag() { drag.on = false; }
    function onWheel(e) {
      e.preventDefault();
      cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.09 : 0.92), 1.3, 8);
      if (onUserMove) onUserMove();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointerleave', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function setAuto(on) { cam.auto = on; }
    function destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointerleave', endDrag);
      canvas.removeEventListener('wheel', onWheel);
    }

    return { cam, setAuto, destroy };
  }

  /* -------------------------------------------------------------------- */
  /* Perspective projection                                                */
  /* -------------------------------------------------------------------- */

  /**
   * Project a world point (y = up) to canvas coordinates.
   * Returns { x, y, d } where d = depth (positive = towards viewer).
   */
  function proj(x, y, z, cam, cx, cy, scale) {
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw);
    const x1 = x * cyw - z * syw;
    const z1 = x * syw + z * cyw;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const persp = cam.dist / Math.max(0.35, cam.dist - z2);
    return { x: cx + x1 * scale * persp, y: cy - y2 * scale * persp, d: z2 };
  }

  /**
   * Resize canvas to its CSS box (DPR-aware) and return ctx + logical size.
   */
  function fitCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 400;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, ctx };
  }

  /* -------------------------------------------------------------------- */
  /* Drawing primitives                                                    */
  /* -------------------------------------------------------------------- */

  /** Polyline through 3D points. alphaFn(p, i) optional per-point alpha. */
  function stroke3D(ctx, pts, cam, cx, cy, scale, stroke, width, dash, alphaFn) {
    if (pts.length < 2) return;
    width = width || 1.4; dash = dash || [];
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    let began = false;
    for (let i = 0; i < pts.length; i++) {
      const p = proj(pts[i].x, pts[i].y, pts[i].z, cam, cx, cy, scale);
      ctx.globalAlpha = alphaFn ? alphaFn(p, i) : 1;
      if (!began) { ctx.beginPath(); ctx.moveTo(p.x, p.y); began = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Text label anchored to a 3D point. */
  function label3D(ctx, text, v, cam, cx, cy, scale, color, font, dx, dy) {
    const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = font || '10px ui-monospace, monospace';
    ctx.fillText(text, p.x + (dx || 4), p.y + (dy || -4));
    ctx.restore();
  }

  /** Filled 3D quad (any 4 world points, drawn in order). */
  function quad3D(ctx, pts, cam, cx, cy, scale, fill, stroke, lineWidth) {
    const p = pts.map((v) => proj(v.x, v.y, v.z, cam, cx, cy, scale));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A proper shaded 3D box (axis-aligned, y = up), drawn with painter-sorted
   * faces. Each vertical face gets its own light response, plus a bright
   * top cap so the bar reads as a solid object from any orbit angle.
   */
  function bar3D(ctx, center, y0, y1, halfW, cam, cx, cy, scale, color, opts) {
    opts = opts || {};
    const { x, z } = center;
    const corners = [
      { x: x - halfW, z: z - halfW },
      { x: x + halfW, z: z - halfW },
      { x: x + halfW, z: z + halfW },
      { x: x - halfW, z: z + halfW },
    ];
    const base = corners.map((c) => proj(c.x, y0, c.z, cam, cx, cy, scale));
    const top = corners.map((c) => proj(c.x, y1, c.z, cam, cx, cy, scale));

    // Per-face brightness based on world orientation
    const faceLight = [0.55, 1.0, 0.7, 0.42]; // -z, +x, +z, -x
    const faces = [];
    for (let f = 0; f < 4; f++) {
      const a = corners[f], b = corners[(f + 1) % 4];
      const depth = proj((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2, cam, cx, cy, scale).d;
      faces.push({ idx: [f, (f + 1) % 4], depth });
    }
    faces.sort((A, B) => A.depth - B.depth); // painter: back to front

    for (const f of faces) {
      const [ia, ib] = f.idx;
      const light = faceLight[ia];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(base[ia].x, base[ia].y);
      ctx.lineTo(base[ib].x, base[ib].y);
      ctx.lineTo(top[ib].x, top[ib].y);
      ctx.lineTo(top[ia].x, top[ia].y);
      ctx.closePath();
      ctx.fillStyle = shade(color, light);
      ctx.fill();
      if (opts.outline) {
        ctx.strokeStyle = opts.outline;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Top cap (always brightest) with optional glow
    ctx.save();
    if (opts.capGlow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = opts.capGlow;
    }
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
    ctx.closePath();
    ctx.fillStyle = tint(color, 1.35);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.restore();
  }

  /** Darken/lighten a hex color by factor f. */
  function shade(hex, f) {
    const [r, g, b] = hexRgb(hex);
    return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  }
  /** Tint a hex color toward white by factor f (1 = same, 2 = 2x brighter). */
  function tint(hex, f) {
    const [r, g, b] = hexRgb(hex);
    return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
  }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [148, 163, 184];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Ground floor grid of a (2*size)×(2*size) square, centered at origin. */
  function drawFloorGrid(ctx, cam, cx, cy, scale, size, divisions, y, color) {
    color = color || 'rgba(96,110,170,0.28)';
    for (let g = 0; g <= divisions; g++) {
      const t = -size + (2 * size * g) / divisions;
      stroke3D(ctx, [{ x: t, y, z: -size }, { x: t, y, z: size }], cam, cx, cy, scale, color, 0.7);
      stroke3D(ctx, [{ x: -size, y, z: t }, { x: size, y, z: t }], cam, cx, cy, scale, color, 0.7);
    }
  }

  /** Arrow (line + solid head) from a to b in 3D. */
  function arrow3D(ctx, a, b, cam, cx, cy, scale, color, width, dash) {
    stroke3D(ctx, [a, b], cam, cx, cy, scale, color, width || 1.6, dash || []);
    const pa = proj(a.x, a.y, a.z, cam, cx, cy, scale);
    const pb = proj(b.x, b.y, b.z, cam, cx, cy, scale);
    const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const hl = 8;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pb.x, pb.y);
    ctx.lineTo(pb.x - hl * Math.cos(ang - 0.42), pb.y - hl * Math.sin(ang - 0.42));
    ctx.lineTo(pb.x - hl * Math.cos(ang + 0.42), pb.y - hl * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Eight-pointed defect star with a bright core. */
  function star3D(ctx, v, cam, cx, cy, scale, color, size) {
    size = size || 6.5;
    const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.7;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * TAU;
      const rr = k % 2 === 0 ? size : size * 0.4;
      const sx = p.x + rr * Math.cos(ang);
      const sy = p.y + rr * Math.sin(ang);
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Great-circle wireframe of a unit sphere (back hemisphere dimmer).
   * Draws: outline disc, equator, two meridians, two latitude rings.
   */
  function drawWireSphere(ctx, cam, cx, cy, R, lineColor, faceColor) {
    lineColor = lineColor || 'rgba(124,116,190,0.6)';
    faceColor = faceColor || 'rgba(23,19,44,0.55)';

    ctx.save();
    // Outline disc
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = faceColor;
    ctx.fill();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const circles = [];
    // Equator (x-z plane at y=0)
    const eq = [];
    for (let a = 0; a <= 72; a++) {
      const t = (a / 72) * TAU;
      eq.push({ x: Math.cos(t), y: 0, z: Math.sin(t) });
    }
    circles.push(eq);
    // Meridian x-y
    const m1 = [];
    for (let a = 0; a <= 48; a++) {
      const t = (a / 48) * TAU;
      m1.push({ x: Math.cos(t), y: Math.sin(t), z: 0 });
    }
    circles.push(m1);
    // Meridian y-z
    const m2 = [];
    for (let a = 0; a <= 48; a++) {
      const t = (a / 48) * TAU;
      m2.push({ x: 0, y: Math.cos(t), z: Math.sin(t) });
    }
    circles.push(m2);
    // Two latitude rings
    for (const yy of [-0.5, 0.5]) {
      const r = Math.sqrt(1 - yy * yy);
      const lat = [];
      for (let a = 0; a <= 60; a++) {
        const t = (a / 60) * TAU;
        lat.push({ x: r * Math.cos(t), y: yy, z: r * Math.sin(t) });
      }
      circles.push(lat);
    }

    for (const c of circles) {
      stroke3D(ctx, c, cam, cx, cy, R, lineColor, 0.9, [], (p) => (p.d < 0 ? 0.3 : 0.8));
    }
    ctx.restore();
  }

  /** Arrow from origin to 3D tip (sphere coordinates, radius ≤ 1). */
  function drawArrow3D(ctx, tip, cam, cx, cy, scale, color, width, dashed) {
    const o = proj(0, 0, 0, cam, cx, cy, scale);
    const t = proj(tip.x, tip.y, tip.z, cam, cx, cy, scale);
    const behind = t.d < 0;
    ctx.save();
    ctx.globalAlpha = behind ? 0.55 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2.6;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    if (dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    // Head
    const ang = Math.atan2(t.y - o.y, t.x - o.x);
    const hl = 10;
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x - hl * Math.cos(ang - 0.42), t.y - hl * Math.sin(ang - 0.42));
    ctx.lineTo(t.x - hl * Math.cos(ang + 0.42), t.y - hl * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Glowing dot at a 3D point. */
  function dot3D(ctx, v, cam, cx, cy, scale, color, r, glow) {
    r = r || 3;
    const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
    ctx.save();
    if (glow > 0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = p.d < 0 ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Linear interpolation between two 3D vectors. */
  function lerpV(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  // Export to global namespace
  global.Qec3D = {
    TAU, clamp,
    makeCam, attachOrbitCam,
    proj, fitCanvas,
    stroke3D, label3D, quad3D, bar3D,
    shade, tint, hexRgb,
    drawFloorGrid, arrow3D, star3D,
    drawWireSphere, drawArrow3D, dot3D,
    lerpV,
  };
})(typeof window !== 'undefined' ? window : this);
