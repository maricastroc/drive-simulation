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

describe('crossing scene + render data path', () => {
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

  it('geometry places lanes as a horizontal/vertical crossing', () => {
    const g = createScene(1).geometry;
    // Lane 0 (A) runs left -> junction; lane 2 (B) runs top -> junction.
    expect(placementAt(g, 0, 0).x).toBeCloseTo(-100);
    expect(placementAt(g, 0, 100).x).toBeCloseTo(0);
    expect(placementAt(g, 2, 0).y).toBeCloseTo(-80);
    expect(placementAt(g, 2, 80).y).toBeCloseTo(0);
  });

  it('both movements run: cars reach the outgoing lanes and trips complete', () => {
    const scene = createScene(2);
    let sawMajorOut = false;
    let sawMinorOut = false;
    for (let n = 0; n < 800; n++) {
      tick(scene.world);
      if (scene.world.occ.head[1] !== NONE) sawMajorOut = true; // lane C
      if (scene.world.occ.head[3] !== NONE) sawMinorOut = true; // lane D
    }
    expect(sawMajorOut).toBe(true);
    expect(sawMinorOut).toBe(true);
    expect(scene.world.metrics.completedTrips).toBeGreaterThan(0);
    expect(scene.world.agents.activeCount).toBeLessThanOrEqual(scene.world.agents.capacity);
  });

  it('setDemandRate turns inflow on and off', () => {
    const scene = createScene(0); // no demand on either road
    for (let n = 0; n < 50; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBe(0);

    setDemandRate(scene, 2);
    for (let n = 0; n < 120; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });
});
