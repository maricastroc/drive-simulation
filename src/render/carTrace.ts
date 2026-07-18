import type { World } from '@/engine';

export interface CarRoute {
  readonly lanes: number[];
  readonly idx: number;
}

export function carRoute(world: World, id: number): CarRoute | null {
  const { agents, routeBuffer } = world;
  const start = agents.routeStart[id];
  const end = agents.routeEnd[id];
  if (end <= start) return null;
  const lanes: number[] = [];
  for (let i = start; i < end; i++) lanes.push(routeBuffer[i]);
  return { lanes, idx: agents.routeIdx[id] - start };
}

export function isSelectedCarLive(world: World, id: number, key: number): boolean {
  return id >= 0 && world.agents.active[id] === 1 && world.agents.enterTime[id] === key;
}

export function carProgress(world: World, id: number): number {
  const r = carRoute(world, id);
  if (!r) return 0;
  const len = world.graph.length;
  let total = 0;
  for (const lane of r.lanes) total += len[lane];
  if (total <= 0) return 0;
  let done = 0;
  for (let i = 0; i < r.idx; i++) done += len[r.lanes[i]];
  done += Math.min(world.agents.s[id], len[r.lanes[r.idx]]);
  return Math.min(1, done / total);
}
