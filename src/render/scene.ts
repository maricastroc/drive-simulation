import { createWorld, computeRoute, addRoute, type World, type RouteRef } from '@/engine';
import { buildGrid } from './grid';
import type { LaneGeometry } from './geometry';

const CAPACITY = 256;
const SEED = 0x9e3779b9;
const GRID = 2; // rows == cols

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
}

/**
 * A one-way Manhattan grid. Cars enter at the perimeter, are routed (shortest path) to a random
 * reachable exit, and turn / give way at each junction as they cross the network. `rate` is the
 * per-entry inflow (cars/second). The engine owns all population, routing, and priority.
 */
export function createScene(rate: number): Scene {
  const { graph, geometry, sources, sinks } = buildGrid(GRID, GRID);
  const world = createWorld(graph, CAPACITY, undefined, SEED);

  for (const src of sources) {
    const routes: RouteRef[] = [];
    for (const sink of sinks) {
      const path = computeRoute(graph, src, sink);
      if (path && path.length > 1) routes.push(addRoute(world, path));
    }
    if (routes.length > 0) world.demand.push({ lane: src, rate, routes });
  }

  return { world, geometry };
}

/** Tune the per-entry inflow live, without rebuilding the scene. */
export function setDemandRate(scene: Scene, rate: number): void {
  for (const src of scene.world.demand) src.rate = rate;
}
