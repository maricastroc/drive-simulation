import { describe, it, expect } from 'vitest';
import { tick, type World } from '@/engine';
import { createScene, setDemandRate } from '../scene';

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

describe('grid scene + render data path', () => {
  it('starts empty and fills from demand', () => {
    const scene = createScene(1);
    expect(scene.world.agents.activeCount).toBe(0);
    for (let n = 0; n < 200; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });

  it('admitted cars accelerate: average speed rises above zero', () => {
    const scene = createScene(1);
    for (let n = 0; n < 200; n++) tick(scene.world);
    expect(avgSpeed(scene.world)).toBeGreaterThan(0);
  });

  it('has one geometry segment per lane', () => {
    const scene = createScene(1);
    expect(scene.geometry.a.length).toBe(scene.world.graph.laneCount);
    expect(scene.geometry.b.length).toBe(scene.world.graph.laneCount);
  });

  it('routes cars across the grid and completes trips', () => {
    const scene = createScene(1);
    for (let n = 0; n < 1200; n++) tick(scene.world);
    expect(scene.world.metrics.completedTrips).toBeGreaterThan(0);
    expect(scene.world.agents.activeCount).toBeLessThanOrEqual(scene.world.agents.capacity);
  });

  it('setDemandRate turns inflow on and off', () => {
    const scene = createScene(0);
    for (let n = 0; n < 50; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBe(0);

    setDemandRate(scene, 1);
    for (let n = 0; n < 200; n++) tick(scene.world);
    expect(scene.world.agents.activeCount).toBeGreaterThan(0);
  });
});
