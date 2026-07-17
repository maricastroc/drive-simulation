import { buildLaneGraph, createWorld, computeRoute, addRoute, type World } from '@/engine';
import type { LaneGeometry } from './geometry';

const IN_LEN = 120; // metres (approach from the west)
const STRAIGHT_LEN = 120; // metres (continues east)
const BRANCH_LEN = 110; // metres (turns south)
const SPEED_LIMIT = 16; // m/s
const CAPACITY = 64;
const SEED = 0x9e3779b9;

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
}

/**
 * A routing fork. One approach splits into two exits; each spawned car is routed (shortest
 * path) to one of the two destinations, so ~half continue straight and ~half turn:
 *   lane 0 = IN (west) -> lane 1 = STRAIGHT (east)   [route 0->1]
 *                      -> lane 2 = BRANCH  (south)   [route 0->2]
 *
 * `rate` sets the inflow (cars/second). The engine (FASE 0/3 + routing) owns all population.
 */
export function createScene(rate: number): Scene {
  const graph = buildLaneGraph(
    [
      { length: IN_LEN, speedLimit: SPEED_LIMIT, fromNode: 0, toNode: 1 }, // IN
      { length: STRAIGHT_LEN, speedLimit: SPEED_LIMIT, fromNode: 1, toNode: 2 }, // STRAIGHT (sink)
      { length: BRANCH_LEN, speedLimit: SPEED_LIMIT, fromNode: 1, toNode: 3 }, // BRANCH (sink)
    ],
    [
      { fromLane: 0, toLane: 1 }, // straight
      { fromLane: 0, toLane: 2 }, // turn
    ],
  );
  const world = createWorld(graph, CAPACITY, undefined, SEED);
  const straight = addRoute(world, computeRoute(graph, 0, 1) ?? []);
  const turn = addRoute(world, computeRoute(graph, 0, 2) ?? []);
  world.demand.push({ lane: 0, rate, routes: [straight, turn] });

  // Geometry (metres) — segment lengths match the graph lengths so s maps 1:1.
  const geometry: LaneGeometry = {
    a: [
      { x: -IN_LEN, y: 0 }, // IN start
      { x: 0, y: 0 }, // STRAIGHT start (junction)
      { x: 0, y: 0 }, // BRANCH start (junction)
    ],
    b: [
      { x: 0, y: 0 }, // IN end (junction)
      { x: STRAIGHT_LEN, y: 0 }, // STRAIGHT end
      { x: 0, y: BRANCH_LEN }, // BRANCH end
    ],
  };
  return { world, geometry };
}

/** Tune the inflow live, without rebuilding the scene. */
export function setDemandRate(scene: Scene, rate: number): void {
  const src = scene.world.demand[0];
  if (src) src.rate = rate;
}
