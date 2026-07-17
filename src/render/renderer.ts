import type { Scene } from './scene';
import { placementAt } from './geometry';

export interface RenderCar {
  readonly lane: number;
  readonly s: number; // interpolated longitudinal position (m)
  readonly length: number; // vehicle length (m)
  readonly speedFrac: number; // 0 = stopped, 1 = at desired speed
}

/**
 * Draw the whole scene in CSS pixels. The caller sets up the device-pixel-ratio transform, so
 * this function only ever thinks in CSS pixels. The camera fits every lane's geometry into the
 * canvas with a single uniform scale, so vertical roads read as vertical.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  cars: readonly RenderCar[],
): void {
  const geom = scene.geometry;
  const n = geom.a.length;

  // World-space bounds over every lane endpoint.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    for (const p of [geom.a[i], geom.b[i]]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const pad = 36;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const ox = (width - spanX * scale) / 2 - minX * scale;
  const oy = (height - spanY * scale) / 2 - minY * scale;
  const sx = (x: number) => ox + x * scale;
  const sy = (y: number) => oy + y * scale;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';

  // Road surfaces.
  ctx.strokeStyle = '#171a21';
  ctx.lineWidth = 6 * scale;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(sx(geom.a[i].x), sy(geom.a[i].y));
    ctx.lineTo(sx(geom.b[i].x), sy(geom.b[i].y));
    ctx.stroke();
  }

  // Centre dashes.
  ctx.strokeStyle = 'rgba(148,163,184,0.18)';
  ctx.lineWidth = Math.max(1, 0.16 * scale);
  ctx.setLineDash([12, 14]);
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(sx(geom.a[i].x), sy(geom.a[i].y));
    ctx.lineTo(sx(geom.b[i].x), sy(geom.b[i].y));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Cars.
  for (const c of cars) {
    const p = placementAt(geom, c.lane, c.s);
    const L = Math.max(6, c.length * scale);
    const W = Math.max(4, 2.2 * scale);
    const color = speedColor(c.speedFrac);
    ctx.save();
    ctx.translate(sx(p.x), sy(p.y));
    ctx.rotate(p.heading);
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    roundedRect(ctx, -L / 2, -W / 2, L, W, Math.min(W * 0.4, 5));
    ctx.fill();
    ctx.restore();
  }
}

function speedColor(frac: number): string {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  const hue = 8 + 132 * f; // red (stopped) -> green (free flow)
  return `hsl(${hue} 80% 55%)`;
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
