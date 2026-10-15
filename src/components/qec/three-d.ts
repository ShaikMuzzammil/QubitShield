'use client';

/**
 * Minimal high-performance 3D engine shared by the Quantum Lab visualizers.
 * Pure Canvas-2D rendering with perspective projection, painter sorting and
 * an orbit camera (drag to rotate, wheel/pinch to zoom) — zero dependencies.
 *
 * v6: adds depth-sorted shaded bars (bar3D), filled quads (quad3D), defect
 * stars, axis arrows with heads, floor grids and a gentle auto-orbit so a
 * scene is never a dead still image.
 */

import { useCallback, useEffect, useRef } from 'react';

export interface Cam {
  yaw: number;
  pitch: number;
  dist: number; // in scene units (scene radius = 1)
  auto: boolean; // auto-rotate (gentle idle spin)
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface P2 {
  x: number;
  y: number;
  d: number; // depth after rotation (positive = towards viewer)
}

export function useOrbitCam(initial?: Partial<Cam>, onUserMove?: () => void) {
  const cam = useRef<Cam>({ yaw: 0.6, pitch: 0.42, dist: 3.2, auto: false, ...initial });
  const drag = useRef({ on: false, px: 0, py: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moveCb = useRef(onUserMove);
  useEffect(() => {
    moveCb.current = onUserMove;
  }, [onUserMove]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { on: true, px: e.clientX, py: e.clientY };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    cam.current.auto = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.on) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    drag.current.px = e.clientX;
    drag.current.py = e.clientY;
    cam.current.yaw += dx * 0.0085;
    cam.current.pitch = Math.max(-1.35, Math.min(1.35, cam.current.pitch + dy * 0.006));
    moveCb.current?.();
  }, []);

  const endDrag = useCallback(() => {
    drag.current.on = false;
  }, []);

  /** Enable/disable the gentle auto-orbit (call from UI controls). */
  const setAuto = useCallback((on: boolean) => {
    cam.current.auto = on;
  }, []);

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    cam.current.dist = Math.max(1.3, Math.min(8, cam.current.dist * (e.deltaY > 0 ? 1.09 : 0.92)));
    moveCb.current?.();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  return { cam, canvasRef, setAuto, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerLeave: endDrag };
}

/** Perspective-project a world point (y = up) to canvas coordinates. */
export function proj(x: number, y: number, z: number, cam: Cam, cx: number, cy: number, scale: number): P2 {
  const cyw = Math.cos(cam.yaw);
  const syw = Math.sin(cam.yaw);
  const x1 = x * cyw - z * syw;
  const z1 = x * syw + z * cyw;
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const persp = cam.dist / Math.max(0.35, cam.dist - z2);
  return { x: cx + x1 * scale * persp, y: cy - y2 * scale * persp, d: z2 };
}

/** Resize canvas to its CSS box (DPR aware) and return ctx + logical size. */
export function fitCanvas(cv: HTMLCanvasElement): { w: number; h: number; ctx: CanvasRenderingContext2D } | null {
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 600;
  const h = cv.clientHeight || 400;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

/** Polyline through 3D points. */
export function stroke3D(
  ctx: CanvasRenderingContext2D,
  pts: Vec3[],
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  stroke: string,
  width = 1.4,
  dash: number[] = [],
  alphaFn?: (p: P2, i: number) => number
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  let began = false;
  for (let i = 0; i < pts.length; i++) {
    const p = proj(pts[i].x, pts[i].y, pts[i].z, cam, cx, cy, scale);
    ctx.globalAlpha = alphaFn ? alphaFn(p, i) : 1;
    if (!began) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      began = true;
    } else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Text label anchored to a 3D point. */
export function label3D(
  ctx: CanvasRenderingContext2D,
  text: string,
  v: Vec3,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  font = '10px ui-monospace, monospace',
  dx = 4,
  dy = -4
) {
  const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(text, p.x + dx, p.y + dy);
  ctx.restore();
}

/** Filled 3D quad (any 4 world points, drawn in the given order). */
export function quad3D(
  ctx: CanvasRenderingContext2D,
  pts: [Vec3, Vec3, Vec3, Vec3],
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  fill: string,
  stroke?: string,
  lineWidth = 1
) {
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
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A proper shaded 3D box (axis-aligned, y = up), drawn with painter-sorted
 * faces: each vertical face gets its own light response so the bar reads as
 * a solid object from any orbit angle, plus a bright top cap.
 */
export function bar3D(
  ctx: CanvasRenderingContext2D,
  center: { x: number; z: number },
  y0: number,
  y1: number,
  halfW: number,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  opts?: { capGlow?: number; outline?: string }
) {
  const { x, z } = center;
  const corners = [
    { x: x - halfW, z: z - halfW },
    { x: x + halfW, z: z - halfW },
    { x: x + halfW, z: z + halfW },
    { x: x - halfW, z: z + halfW },
  ];
  const base = corners.map((c) => proj(c.x, y0, c.z, cam, cx, cy, scale));
  const top = corners.map((c) => proj(c.x, y1, c.z, cam, cx, cy, scale));

  // vertical faces with per-face brightness based on their world orientation
  const faceLight = [0.55, 1.0, 0.7, 0.42]; // -z, +x, +z, -x
  const faces: { idx: [number, number]; depth: number }[] = [];
  for (let f = 0; f < 4; f++) {
    const a = corners[f];
    const b = corners[(f + 1) % 4];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const depth = proj(mx, (y0 + y1) / 2, mz, cam, cx, cy, scale).d;
    faces.push({ idx: [f, (f + 1) % 4], depth });
  }
  faces.sort((A, B) => A.depth - B.depth); // painter: back to front

  for (const f of faces) {
    const [ia, ib] = f.idx;
    const light = faceLight[ia];
    const col = shade(color, light);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(base[ia].x, base[ia].y);
    ctx.lineTo(base[ib].x, base[ib].y);
    ctx.lineTo(top[ib].x, top[ib].y);
    ctx.lineTo(top[ia].x, top[ia].y);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    if (opts?.outline) {
      ctx.strokeStyle = opts.outline;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  // top cap (always the brightest part) with optional glow
  ctx.save();
  if (opts?.capGlow) {
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

  return { top, base };
}

/** Darken/lighten a hex or hsl-ish css color — works on #rrggbb. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

/** Tint a hex color towards white by factor f (1 = same, 2 = 2x brighter). */
export function tint(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [148, 163, 184];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Ground floor grid of a (2*size)×(2*size) square, centered at origin. */
export function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  size: number,
  divisions: number,
  y: number,
  color = 'rgba(96,110,170,0.28)'
) {
  for (let g = 0; g <= divisions; g++) {
    const t = -size + (2 * size * g) / divisions;
    stroke3D(ctx, [{ x: t, y, z: -size }, { x: t, y, z: size }], cam, cx, cy, scale, color, 0.7);
    stroke3D(ctx, [{ x: -size, y, z: t }, { x: size, y, z: t }], cam, cx, cy, scale, color, 0.7);
  }
}

/** Arrow (line + solid head) from a to b in 3D. */
export function arrow3D(
  ctx: CanvasRenderingContext2D,
  a: Vec3,
  b: Vec3,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  width = 1.6,
  dash: number[] = []
) {
  stroke3D(ctx, [a, b], cam, cx, cy, scale, color, width, dash);
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
export function star3D(
  ctx: CanvasRenderingContext2D,
  v: Vec3,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  size = 6.5
) {
  const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
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
  ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Great-circle wireframe of a unit sphere (back hemisphere first if split). */
export function drawWireSphere(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  cx: number,
  cy: number,
  R: number,
  lineColor = 'rgba(124,116,190,0.6)',
  faceColor = 'rgba(23,19,44,0.55)'
) {
  // outline disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = faceColor;
  ctx.fill();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const circles: Vec3[][] = [];
  // equator (x-z plane at y=0)
  const eq: Vec3[] = [];
  for (let a = 0; a <= 72; a++) {
    const t = (a / 72) * Math.PI * 2;
    eq.push({ x: Math.cos(t), y: 0, z: Math.sin(t) });
  }
  circles.push(eq);
  // meridian x-y
  const m1: Vec3[] = [];
  for (let a = 0; a <= 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    m1.push({ x: Math.cos(t), y: Math.sin(t), z: 0 });
  }
  circles.push(m1);
  // meridian y-z
  const m2: Vec3[] = [];
  for (let a = 0; a <= 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    m2.push({ x: 0, y: Math.cos(t), z: Math.sin(t) });
  }
  circles.push(m2);
  // extra latitude rings
  for (const yy of [-0.5, 0.5]) {
    const r = Math.sqrt(1 - yy * yy);
    const lat: Vec3[] = [];
    for (let a = 0; a <= 60; a++) {
      const t = (a / 60) * Math.PI * 2;
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
export function drawArrow3D(
  ctx: CanvasRenderingContext2D,
  tip: Vec3,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  width = 2.6,
  dashed = false
) {
  const o = proj(0, 0, 0, cam, cx, cy, scale);
  const t = proj(tip.x, tip.y, tip.z, cam, cx, cy, scale);
  const behind = t.d < 0;
  ctx.save();
  ctx.globalAlpha = behind ? 0.55 : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(t.x, t.y);
  ctx.stroke();
  // head
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

export function dot3D(
  ctx: CanvasRenderingContext2D,
  v: Vec3,
  cam: Cam,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  r = 3,
  glow = 0
) {
  const p = proj(v.x, v.y, v.z, cam, cx, cy, scale);
  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = p.d < 0 ? 0.45 : 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** small axis cross at the origin of a lattice cell (helper for slabs) */
export function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
