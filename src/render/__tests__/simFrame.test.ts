import { describe, it, expect } from 'vitest';
import { tick } from '@/engine';
import { createScene } from '../scene';
import { packFrame, frameStats, framesToCars, frameLength } from '../simFrame';

function warm(scene: ReturnType<typeof createScene>, n: number) {
  for (let i = 0; i < n; i++) tick(scene.world);
}

describe('simFrame', () => {
  it('packs a frame sized to the agent capacity', () => {
    const scene = createScene(0.6);
    const f = packFrame(scene.world);
    expect(f.length).toBe(frameLength(scene.world.agents.capacity));
  });

  it('frameStats matches the world it was packed from', () => {
    const scene = createScene(0.8);
    warm(scene, 300);
    const f = packFrame(scene.world);
    const s = frameStats(f);
    expect(s.completedTrips).toBe(scene.world.metrics.completedTrips);
    expect(s.cars).toBe(scene.world.agents.activeCount);
    expect(s.time).toBeCloseTo(scene.world.time, 4);
  });

  it('framesToCars yields one car per active agent, positions between prev and cur at alpha', () => {
    const scene = createScene(0.8);
    warm(scene, 200);
    const prev = packFrame(scene.world);
    tick(scene.world);
    const cur = packFrame(scene.world);

    const g = scene.world.graph;
    const at0 = framesToCars(prev, cur, 0, scene.world.vparams, g.speedLimit);
    const at1 = framesToCars(prev, cur, 1, scene.world.vparams, g.speedLimit);
    expect(at1.length).toBe(scene.world.agents.activeCount);

    const both = at1.find((c) => {
      const o = 3 + c.id * 6;
      return prev[o] > 0.5 && prev[o + 1] === c.lane;
    });
    expect(both).toBeDefined();
    const car0 = at0.find((c) => c.id === both!.id)!;
    const o = 3 + both!.id * 6;
    expect(car0.s).toBeCloseTo(prev[o + 2], 4);
    expect(both!.s).toBeCloseTo(cur[o + 2], 4);
  });

  it('with no prev frame, cars render at their current position', () => {
    const scene = createScene(0.8);
    warm(scene, 150);
    const cur = packFrame(scene.world);
    const cars = framesToCars(null, cur, 0.5, scene.world.vparams, scene.world.graph.speedLimit);
    expect(cars.length).toBe(scene.world.agents.activeCount);
  });
});
