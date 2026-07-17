import { buildLaneGraph, createWorld, type World } from '@/engine';
import type { LaneGeometry } from './geometry';

const MAJOR_LEN = 100; // metres (horizontal road: A -> C)
const MINOR_LEN = 80; // metres (vertical road: B -> D)
const SPEED_LIMIT = 16; // m/s
const CAPACITY = 64;
const SEED = 0x9e3779b9;
const MINOR_FRACTION = 0.7; // minor-road demand relative to the main road

export interface Scene {
  readonly world: World;
  readonly geometry: LaneGeometry;
}

/**
 * A priority crossing. Two roads meet at a give-way junction:
 *   lane 0 = A (major in) -> lane 1 = C (major out)   — horizontal, has priority
 *   lane 2 = B (minor in) -> lane 3 = D (minor out)   — vertical, yields
 * A->C (rank 2) and B->D (rank 1) conflict at the node. Connections group by fromLane, so
 * A->C is index 0 and B->D is index 1.
 *
 * `rate` sets the main-road demand (cars/second); the minor road is a fixed fraction of it.
 * The engine (FASE 0/3) owns all population — no render-side harness.
 */
export function createScene(rate: number): Scene {
  const graph = buildLaneGraph(
    [
      { length: MAJOR_LEN, speedLimit: SPEED_LIMIT, fromNode: 0, toNode: 1 }, // A
      { length: MAJOR_LEN, speedLimit: SPEED_LIMIT, fromNode: 1, toNode: 2 }, // C (sink)
      { length: MINOR_LEN, speedLimit: SPEED_LIMIT, fromNode: 3, toNode: 1 }, // B
      { length: MINOR_LEN, speedLimit: SPEED_LIMIT, fromNode: 1, toNode: 4 }, // D (sink)
    ],
    [
      { fromLane: 0, toLane: 1, rank: 2, conflicts: [1] }, // A->C major (index 0)
      { fromLane: 2, toLane: 3, rank: 1, conflicts: [0] }, // B->D minor (index 1)
    ],
  );
  const world = createWorld(graph, CAPACITY, undefined, SEED);
  world.demand.push({ lane: 0, rate }); // demand[0] = main road
  world.demand.push({ lane: 2, rate: rate * MINOR_FRACTION }); // demand[1] = minor road

  // Geometry (metres) — segment lengths match the graph lengths so s maps 1:1.
  const geometry: LaneGeometry = {
    a: [
      { x: -MAJOR_LEN, y: 0 }, // A start
      { x: 0, y: 0 }, // C start (junction)
      { x: 0, y: -MINOR_LEN }, // B start
      { x: 0, y: 0 }, // D start (junction)
    ],
    b: [
      { x: 0, y: 0 }, // A end (junction)
      { x: MAJOR_LEN, y: 0 }, // C end
      { x: 0, y: 0 }, // B end (junction)
      { x: 0, y: MINOR_LEN }, // D end
    ],
  };
  return { world, geometry };
}

/** Tune the main-road demand live (the minor road scales with it), without rebuilding. */
export function setDemandRate(scene: Scene, rate: number): void {
  const [main, minor] = scene.world.demand;
  if (main) main.rate = rate;
  if (minor) minor.rate = rate * MINOR_FRACTION;
}
