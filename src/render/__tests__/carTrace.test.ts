import { describe, it, expect } from 'vitest';
import { tick } from '@/engine';
import { createScene } from '@/render/scene';
import { carRoute, carProgress, isSelectedCarLive } from '@/render/carTrace';

function firstActiveCar(rate = 0.6) {
  const scene = createScene(rate);
  for (let i = 0; i < 80 && scene.world.agents.activeCount === 0; i++) tick(scene.world);
  const { agents } = scene.world;
  let id = -1;
  for (let k = 0; k < agents.capacity; k++) if (agents.active[k]) { id = k; break; }
  return { scene, id };
}

describe('carTrace', () => {
  it('reads the agent’s route slice, with idx at its current lane', () => {
    const { scene, id } = firstActiveCar();
    expect(id).toBeGreaterThanOrEqual(0);
    const r = carRoute(scene.world, id)!;
    expect(r).not.toBeNull();
    expect(r.lanes.length).toBeGreaterThan(1);
    expect(r.lanes[r.idx]).toBe(scene.world.agents.lane[id]);
    expect(r.idx).toBeGreaterThanOrEqual(0);
    expect(r.idx).toBeLessThan(r.lanes.length);
  });

  it('progress is a fraction that never runs backwards while the car drives', () => {
    const { scene, id } = firstActiveCar();
    const key = scene.world.agents.enterTime[id];
    let prev = carProgress(scene.world, id);
    expect(prev).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 40; i++) {
      tick(scene.world);
      if (!isSelectedCarLive(scene.world, id, key)) break;
      const p = carProgress(scene.world, id);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(p).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it('identity survives only for the exact (id, enterTime) vehicle', () => {
    const { scene, id } = firstActiveCar();
    const key = scene.world.agents.enterTime[id];
    expect(isSelectedCarLive(scene.world, id, key)).toBe(true);
    expect(isSelectedCarLive(scene.world, id, key + 1)).toBe(false);
    const { agents } = scene.world;
    let inactive = -1;
    for (let k = 0; k < agents.capacity; k++) if (!agents.active[k]) { inactive = k; break; }
    expect(inactive).toBeGreaterThanOrEqual(0);
    expect(isSelectedCarLive(scene.world, inactive, 0)).toBe(false);
  });
});
