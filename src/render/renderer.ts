import type { Scene } from './scene';
import { fitCamera, project, placementAt, type Camera, type LaneGeometry } from './geometry';
import { SIGNAL_GREEN, SIGNAL_RED } from '@/engine';

export interface RenderCar {
  readonly lane: number;
  readonly s: number; // interpolated longitudinal position (m)
  readonly length: number; // vehicle length (m)
  readonly speedFrac: number; // 0 = stopped, 1 = at desired speed
}

/** What the interactive canvas currently has selected or hovered (-1 = none). */
export interface RenderOverlay {
  readonly selectedLane: number;
  readonly hoverLane: number;
  readonly selectedJunction: number;
  readonly hoverJunction: number;
  readonly now: number; // ms timestamp, drives selection/hover animation
}

const NO_OVERLAY: RenderOverlay = {
  selectedLane: -1,
  hoverLane: -1,
  selectedJunction: -1,
  hoverJunction: -1,
  now: 0,
};

// Palette mirrors the CSS tokens in globals.css so canvas and chrome read as one system.
const C = {
  curb: '#0a0d12',
  asphalt: [0x22, 0x28, 0x32] as const,
  jam: [0x6e, 0x2f, 0x2c] as const, // congested asphalt (warm)
  dash: 'rgba(150,160,175,0.16)',
  closed: '#3a1b1f',
  barrier: '#fb6a68',
  junction: 'rgba(150,160,175,0.42)',
  accent: '#4f8ff7',
  green: '#37d29b',
  red: '#fb6a68',
  amber: '#f4b740',
  exit: 'rgba(150,160,175,0.55)',
};

/**
 * Draw the whole scene in CSS pixels — a depth-cued background, roads cased like map tiles with a
 * live congestion tint, the Scenario-Control overlay (closures, incidents, signals, priority),
 * glowing cars, and animated selection/hover. The caller sets up the device-pixel-ratio transform.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  cars: readonly RenderCar[],
  overlay: RenderOverlay = NO_OVERLAY,
): void {
  const geom = scene.geometry;
  const control = scene.world.control;
  const n = geom.a.length;
  const cam = fitCamera(geom, width, height);

  // Per-lane congestion (0 = free, 1 = jammed) from the cars currently on each lane.
  const congSum = new Float32Array(n);
  const congCnt = new Uint16Array(n);
  for (const c of cars) {
    congSum[c.lane] += 1 - Math.max(0, Math.min(1, c.speedFrac));
    congCnt[c.lane] += 1;
  }

  drawBackdrop(ctx, width, height);

  // Selection / hover glow under the road.
  for (let i = 0; i < n; i++) {
    const sel = i === overlay.selectedLane;
    const hov = i === overlay.hoverLane && i !== overlay.selectedLane;
    if (sel) {
      const p = 0.5 + 0.5 * Math.sin(overlay.now / 380);
      strokeLane(ctx, cam, geom, i, `rgba(79,143,247,${0.5 + 0.25 * p})`, (11 + 2 * p) * cam.scale);
    } else if (hov) {
      strokeLane(ctx, cam, geom, i, 'rgba(79,143,247,0.22)', 10 * cam.scale);
    }
  }

  // Road casing: a dark curb, then the asphalt (congestion-tinted) on top.
  const curbW = 7 * cam.scale;
  const roadW = 5 * cam.scale;
  for (let i = 0; i < n; i++) strokeLane(ctx, cam, geom, i, C.curb, curbW);
  for (let i = 0; i < n; i++) {
    if (control.laneClosed[i] === 1) {
      strokeLane(ctx, cam, geom, i, C.closed, roadW);
    } else {
      const cong = congCnt[i] ? congSum[i] / congCnt[i] : 0;
      strokeLane(ctx, cam, geom, i, asphalt(cong), roadW);
    }
  }

  // Centre dashes on open lanes.
  ctx.strokeStyle = C.dash;
  ctx.lineWidth = Math.max(1, 0.16 * cam.scale);
  ctx.setLineDash([11, 15]);
  for (let i = 0; i < n; i++) {
    if (control.laneClosed[i] === 1) continue;
    const a = project(cam, geom.a[i].x, geom.a[i].y);
    const b = project(cam, geom.b[i].x, geom.b[i].y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (let i = 0; i < n; i++) if (control.laneClosed[i] === 1) drawBarrier(ctx, cam, geom, i);

  // Entry (green) and exit (slate) markers.
  for (const ctl of scene.sources) {
    const { ux, uy } = laneDir(cam, geom, ctl.lane);
    const p = project(cam, geom.a[ctl.lane].x, geom.a[ctl.lane].y);
    drawChevron(ctx, p.x, p.y, ux, uy, C.green);
  }
  for (const sink of scene.sinks) {
    const p = project(cam, geom.b[sink].x, geom.b[sink].y);
    ring(ctx, p.x, p.y, 4, C.exit, 2);
  }

  // Cars — glowing capsules coloured by speed.
  for (const c of cars) {
    const p = placementAt(geom, c.lane, c.s);
    const sp = project(cam, p.x, p.y);
    const L = Math.max(6, c.length * cam.scale);
    const W = Math.max(4, 2.2 * cam.scale);
    const color = speedColor(c.speedFrac);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(p.heading);
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = color;
    roundedRect(ctx, -L / 2, -W / 2, L, W, Math.min(W * 0.4, 5));
    ctx.fill();
    ctx.restore();
  }

  // Incidents.
  for (let i = 0; i < n; i++) {
    const at = control.incidentAt[i];
    if (at < Infinity) {
      const p = placementAt(geom, i, at);
      drawIncident(ctx, project(cam, p.x, p.y));
    }
  }

  // Junctions.
  scene.junctions.forEach((j, idx) => {
    const jp = project(cam, j.pos.x, j.pos.y);
    const signalized = scene.signals[idx]?.enabled === true;
    const selected = idx === overlay.selectedJunction;
    const hovered = idx === overlay.hoverJunction && !selected;

    if (signalized) {
      for (const ap of j.approaches) {
        const st = control.signal[ap.conns[0]];
        const color = st === SIGNAL_GREEN ? C.green : st === SIGNAL_RED ? C.red : '#64748b';
        drawSignalHead(ctx, cam, geom, ap.fromLane, color);
      }
    } else {
      let major = j.approaches[0];
      for (const ap of j.approaches) {
        if (control.rank[ap.conns[0]] > control.rank[major.conns[0]]) major = ap;
      }
      drawPriorityTick(ctx, cam, geom, major.fromLane);
    }

    if (hovered) ring(ctx, jp.x, jp.y, 9, 'rgba(79,143,247,0.5)', 2);
    ctx.beginPath();
    ctx.arc(jp.x, jp.y, selected ? 4.5 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = selected ? C.accent : C.junction;
    ctx.fill();
    if (selected) {
      const p = 0.5 + 0.5 * Math.sin(overlay.now / 380);
      ring(ctx, jp.x, jp.y, 9 + 3 * p, `rgba(79,143,247,${0.7 - 0.35 * p})`, 2);
    }
  });
}

// ── background ────────────────────────────────────────────────────────────
function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.44, 0, w / 2, h * 0.44, Math.max(w, h) * 0.72);
  g.addColorStop(0, '#0d1017');
  g.addColorStop(1, '#07080a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Faint engineering dot-grid.
  const step = 26;
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = (h % step) / 2; y < h; y += step) {
    for (let x = (w % step) / 2; x < w; x += step) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
function asphalt(cong: number): string {
  const t = Math.max(0, Math.min(1, cong)) ** 0.85;
  const r = Math.round(C.asphalt[0] + (C.jam[0] - C.asphalt[0]) * t);
  const g = Math.round(C.asphalt[1] + (C.jam[1] - C.asphalt[1]) * t);
  const b = Math.round(C.asphalt[2] + (C.jam[2] - C.asphalt[2]) * t);
  return `rgb(${r},${g},${b})`;
}

function laneDir(cam: Camera, geom: LaneGeometry, lane: number) {
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { ux: dx / len, uy: dy / len, end: project(cam, b.x, b.y) };
}

function strokeLane(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
  style: string,
  lineWidth: number,
): void {
  const a = project(cam, geom.a[lane].x, geom.a[lane].y);
  const b = project(cam, geom.b[lane].x, geom.b[lane].y);
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style: string,
  lw: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = style;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawBarrier(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
): void {
  const a = geom.a[lane];
  const b = geom.b[lane];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const mid = project(cam, a.x + dx * 0.5, a.y + dy * 0.5);
  const half = 4 * cam.scale;
  ctx.strokeStyle = C.barrier;
  ctx.lineWidth = Math.max(2, 1.4 * cam.scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(mid.x - uy * half, mid.y + ux * half);
  ctx.lineTo(mid.x + uy * half, mid.y - ux * half);
  ctx.stroke();
}

function drawIncident(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = C.amber;
  ctx.shadowBlur = 10;
  ctx.fillStyle = C.amber;
  ctx.strokeStyle = '#1a1206';
  ctx.lineWidth = 1.5;
  const r = 7;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, r * 0.8);
  ctx.lineTo(-r, r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.fillStyle = '#1a1206';
  ctx.font = 'bold 9px var(--font-geist-mono), monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 1);
  ctx.restore();
}

function drawSignalHead(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
  color: string,
): void {
  const { ux, uy, end } = laneDir(cam, geom, lane);
  const off = 7 * cam.scale;
  const x = end.x - ux * off;
  const y = end.y - uy * off;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(3.5, 1.7 * cam.scale), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawPriorityTick(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  geom: LaneGeometry,
  lane: number,
): void {
  const { ux, uy, end } = laneDir(cam, geom, lane);
  const off = 7 * cam.scale;
  const x = end.x - ux * off;
  const y = end.y - uy * off;
  const half = Math.max(3, 1.2 * cam.scale);
  ctx.strokeStyle = 'rgba(226,232,240,0.75)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - uy * half, y + ux * half);
  ctx.lineTo(x + uy * half, y - ux * half);
  ctx.stroke();
}

function drawChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ux: number,
  uy: number,
  color: string,
): void {
  const s = 6;
  const px = -uy;
  const py = ux;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + ux * s, y + uy * s);
  ctx.lineTo(x - ux * s + px * s, y - uy * s + py * s);
  ctx.lineTo(x - ux * s - px * s, y - uy * s - py * s);
  ctx.closePath();
  ctx.fill();
}

function speedColor(frac: number): string {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  const hue = 8 + 132 * f; // red (stopped) -> green (free flow)
  return `hsl(${hue} 85% 58%)`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
