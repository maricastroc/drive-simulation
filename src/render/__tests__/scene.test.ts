import { describe, it, expect } from 'vitest';
import { tick, type World } from '@/engine';
import { createScene, setDemandRate, runExperiment, toggleLaneClosed } from '../scene';

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

describe('controlled A/B experiment', () => {
  it('is deterministic — repeated runs on the same scene are identical', () => {
    const scene = createScene(0.6);
    const r1 = runExperiment(scene, 300);
    const r2 = runExperiment(scene, 300);
    expect(r1.baseline).toEqual(r2.baseline);
    expect(r1.intervention).toEqual(r2.intervention);
  });

  it('with no staged change, the intervention equals the baseline (same seed, same config)', () => {
    const r = runExperiment(createScene(0.6), 300);
    expect(r.changes).toEqual([]);
    expect(r.intervention).toEqual(r.baseline);
  });

  it('a closure perturbs the intervention while leaving the baseline untouched', () => {
    const cleanBaseline = runExperiment(createScene(0.6), 400).baseline;

    const scene = createScene(0.6);
    toggleLaneClosed(scene, scene.sources[0].lane);
    const r = runExperiment(scene, 400);

    expect(r.baseline).toEqual(cleanBaseline);
    expect(r.changes).toContain('1 road closed');
    const differs =
      r.intervention.cars !== r.baseline.cars ||
      r.intervention.completedTrips !== r.baseline.completedTrips ||
      r.intervention.avgTravelTime !== r.baseline.avgTravelTime;
    expect(differs).toBe(true);
  });
});
