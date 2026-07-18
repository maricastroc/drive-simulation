import { NONE } from '@/engine';
import type { Scene } from '@/render/scene';
import { carRoute, carProgress, isSelectedCarLive } from '@/render/carTrace';

export const unitsToRate = (u: number) => u * 0.1;

export type Selection =
  | { kind: 'none' }
  | { kind: 'lane'; lane: number; s: number }
  | { kind: 'junction'; j: number }
  | { kind: 'car'; id: number; key: number };

export const NONE_SEL: Selection = { kind: 'none' };

export type SelStats =
  | { kind: 'lane'; cars: number; speedKmh: number; freeKmh: number }
  | { kind: 'junction'; queued: number; greenAxis: string; secLeft: number }
  | { kind: 'car'; speedKmh: number; freeKmh: number; progress: number; hopsLeft: number; dest: number };

export function computeSelStats(scene: Scene, sel: Selection): SelStats | null {
  if (sel.kind === 'none') return null;
  const { agents, occ, graph, vparams } = scene.world;

  if (sel.kind === 'car') {
    if (!isSelectedCarLive(scene.world, sel.id, sel.key)) return null;
    const r = carRoute(scene.world, sel.id);
    const v0 = graph.speedLimit[agents.lane[sel.id]] * vparams[0].v0Factor;
    return {
      kind: 'car',
      speedKmh: agents.v[sel.id] * 3.6,
      freeKmh: v0 * 3.6,
      progress: carProgress(scene.world, sel.id),
      hopsLeft: r ? r.lanes.length - 1 - r.idx : 0,
      dest: r ? r.lanes[r.lanes.length - 1] : -1,
    };
  }

  if (sel.kind === 'lane') {
    let cars = 0;
    let sum = 0;
    for (let id = occ.head[sel.lane]; id !== NONE; id = agents.behind[id]) {
      cars += 1;
      sum += agents.v[id];
    }
    const v0 = graph.speedLimit[sel.lane] * vparams[0].v0Factor;
    return { kind: 'lane', cars, speedKmh: cars ? (sum / cars) * 3.6 : 0, freeKmh: v0 * 3.6 };
  }

  const j = scene.junctions[sel.j];
  let queued = 0;
  for (const ap of j.approaches) {
    for (let id = occ.head[ap.fromLane]; id !== NONE; id = agents.behind[id]) {
      if (agents.v[id] < 0.6) queued += 1;
    }
  }
  const sc = scene.signals[sel.j];
  const on = sc?.enabled === true;
  return {
    kind: 'junction',
    queued,
    greenAxis: on ? (sc!.phase === 0 ? 'E–W' : 'N–S') : '',
    secLeft: on ? Math.max(0, sc!.phaseDur[sc!.phase] - sc!.timeInPhase) : 0,
  };
}

export function compassLabels(pts: { x: number; y: number }[]): string[] {
  if (pts.length === 0) return [];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const counts: Record<string, number> = { N: 0, E: 0, S: 0, W: 0 };
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    counts[side] += 1;
    return `${side}${counts[side]}`;
  });
}

export function scenarioChanged(scene: Scene): boolean {
  const c = scene.world.control;
  const conns = scene.world.graph.connections;
  for (let i = 0; i < c.laneClosed.length; i++) if (c.laneClosed[i] === 1) return true;
  for (let i = 0; i < c.incidentAt.length; i++) if (c.incidentAt[i] < Infinity) return true;
  if (c.signals.some((s) => s.enabled)) return true;
  for (let i = 0; i < c.rank.length; i++) if (c.rank[i] !== conns[i].rank) return true; // priority flipped
  return false;
}
