import { fitCamera, project, unproject, nearestLane, placementAt } from '@/render/geometry';
import type { Scene } from '@/render/scene';
import { NONE_SEL, type Selection } from './types';

/** Pixel tolerances for resolving a click to a map entity. */
export const LANE_TOL_M = 7;
export const JUNCTION_TOL_PX = 15;
export const CAR_TOL_PX = 11;
// A junction is a fixed control the user deliberately aims at, so it wins over a
// car unless the car is clearly the closer target — this many px closer. Without
// it, cars crossing a junction always stole the click at busy intersections.
export const JUNCTION_BIAS_PX = 4;

/** The minimal car shape hit-testing needs (a superset of `RenderCar`). */
export interface HitCar {
  readonly id: number;
  readonly key: number;
  readonly lane: number;
  readonly s: number;
}

export interface HitViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Resolve a click at canvas-local `(px, py)` to a map `Selection`. Cars and
 * junctions are both measured against the fitted camera; the nearer wins, but a
 * junction only loses to a car that is `JUNCTION_BIAS_PX` closer — so an
 * intersection stays clickable even when cars are crossing it. Lanes are the
 * fallback, then nothing.
 *
 * Pure: takes plain data (no DOM), so the priority logic is unit-testable in Node.
 */
export function hitTest(
  scene: Scene,
  cars: readonly HitCar[],
  view: HitViewport,
  px: number,
  py: number,
): Selection {
  const cam = fitCamera(scene.geometry, view.width, view.height);

  let bestCar = -1;
  let bestKey = 0;
  let bestCarD = CAR_TOL_PX;
  for (const c of cars) {
    const p = placementAt(scene.geometry, c.lane, c.s);
    const sp = project(cam, p.x, p.y);
    const d = Math.hypot(sp.x - px, sp.y - py);
    if (d < bestCarD) {
      bestCarD = d;
      bestCar = c.id;
      bestKey = c.key;
    }
  }

  let bestJ = -1;
  let bestJD = JUNCTION_TOL_PX;
  scene.junctions.forEach((j, idx) => {
    const sp = project(cam, j.pos.x, j.pos.y);
    const d = Math.hypot(sp.x - px, sp.y - py);
    if (d < bestJD) {
      bestJD = d;
      bestJ = idx;
    }
  });

  if (bestJ >= 0 && (bestCar < 0 || bestJD <= bestCarD + JUNCTION_BIAS_PX)) {
    return { kind: 'junction', j: bestJ };
  }
  if (bestCar >= 0) return { kind: 'car', id: bestCar, key: bestKey };

  const world = unproject(cam, px, py);
  const hit = nearestLane(scene.geometry, world, LANE_TOL_M);
  if (hit.lane >= 0) return { kind: 'lane', lane: hit.lane, s: hit.s };
  return NONE_SEL;
}
