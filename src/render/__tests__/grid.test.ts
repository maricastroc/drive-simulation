import { describe, it, expect } from 'vitest';
import { createWorld, tick, computeRoute, addRoute, NONE, EPS, type World, type RouteRef } from '@/engine';
import { buildGrid } from '../grid';

function setupGrid(seed: number, rate = 0.35): World {
  const { graph, sources, sinks } = buildGrid(2, 2);
  const world = createWorld(graph, 256, undefined, seed);
  for (const src of sources) {
    const routes: RouteRef[] = [];
    for (const sink of sinks) {
      const path = computeRoute(graph, src, sink);
      if (path && path.length > 1) routes.push(addRoute(world, path));
    }
    if (routes.length > 0) world.demand.push({ lane: src, rate, routes });
  }
  return world;
}

function noOverlapAll(world: World): boolean {
  const { agents, occ, vparams, graph } = world;
  for (let lane = 0; lane < graph.laneCount; lane++) {
    let prev = NONE;
    for (let id = occ.head[lane]; id !== NONE; id = agents.behind[id]) {
      if (prev !== NONE) {
        const gap = agents.s[prev] - agents.s[id] - vparams[agents.type[prev]].length;
        if (gap < -EPS) return false;
      }
      prev = id;
    }
  }
  return true;
}

describe('grid: generated Manhattan network', () => {
  it('builds a 2x2 grid with four entries and four exits', () => {
    const { sources, sinks, graph } = buildGrid(2, 2);
    expect(graph.laneCount).toBe(12);
    expect(sources.length).toBe(4);
    expect(sinks.length).toBe(4);
  });

  it('routes traffic across the grid with no overlap on any lane, and trips complete', () => {
    const world = setupGrid(42);
    for (let n = 0; n < 1500; n++) {
      tick(world);
      expect(noOverlapAll(world)).toBe(true);
    }
    expect(world.metrics.completedTrips).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = setupGrid(7);
    const b = setupGrid(7);
    for (let n = 0; n < 400; n++) {
      tick(a);
      tick(b);
    }
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.lane[i]).toBe(b.agents.lane[i]);
    }
  });
});
