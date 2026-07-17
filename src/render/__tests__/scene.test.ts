import { describe, it, expect } from 'vitest';
import { tick, NONE, type World } from '@/engine';
import { createScene, setDemandRate } from '../scene';
import { placementAt } from '../geometry';

function avgSpeed(world: World): number {
  const { agents } = world;
  let sum = 0;
  let n = 0;
  for (let id = 0; id < agents.capacity; id++) {
    if (!agents.active[id]) continue;
    sum += agents.v[id];
    n += 1;
  }
  return n ? sum / n : 0;
}

describe('fork scene + render data path', () => {
  it('starts empty and fills from demand', () => {
    const scene = createScene(2);
    expect(scene.world.agents.activeCount).toBe(0);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });

  it('admitted cars accelerate: average speed rises above zero', () => {
    const scene = createScene(2);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(avgSpeed(scene.world)).toBeGreaterThan(0);
  });

  it('geometry places the approach and the branch as a fork', () => {
    const g = createScene(1).geometry;
    expect(placementAt(g, 0, 0).x).toBeCloseTo(-120); // IN starts to the west
    expect(placementAt(g, 0, 120).x).toBeCloseTo(0); //  and reaches the junction
    expect(placementAt(g, 2, 0).y).toBeCloseTo(0); //   BRANCH leaves the junction
    expect(placementAt(g, 2, 110).y).toBeCloseTo(110); // heading south
  });

  it('routes cars down both exits and completes trips', () => {
    const scene = createScene(2);
    let sawStraight = false;
    let sawTurn = false;
    for (let n = 0; n < 800; n++) {
      tick(scene.world);
      if (scene.world.occ.head[1] !== NONE) sawStraight = true; // straight exit
      if (scene.world.occ.head[2] !== NONE) sawTurn = true; // branch exit
    }
    expect(sawStraight).toBe(true);
    expect(sawTurn).toBe(true);
    expect(scene.world.metrics.completedTrips).toBeGreaterThan(0);
  });

  it('setDemandRate turns inflow on and off', () => {
    const scene = createScene(0);
    for (let n = 0; n < 50; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBe(0);

    setDemandRate(scene, 2);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });
});
