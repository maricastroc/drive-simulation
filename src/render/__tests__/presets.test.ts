import { describe, it, expect } from 'vitest';
import { tick } from '@/engine';
import { createScene } from '@/render/scene';
import { PRESETS, NETWORKS, centralJunction } from '@/render/presets';

const closedCount = (scene: ReturnType<typeof createScene>) => {
  const a = scene.world.control.laneClosed;
  let n = 0;
  for (let i = 0; i < a.length; i++) n += a[i];
  return n;
};
const signalCount = (scene: ReturnType<typeof createScene>) =>
  scene.signals.filter((s) => s?.enabled).length;
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe('experiment presets', () => {
  it('exposes the roadmap scenarios', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['rush', 'artery', 'signal', 'wave']);
  });

  it('picks a deterministic junction nearest the centre', () => {
    expect(centralJunction(createScene(0))).toBe(centralJunction(createScene(0)));
    const scene = createScene(0);
    const js = scene.junctions;
    const cx = js.reduce((s, j) => s + j.pos.x, 0) / js.length;
    const cy = js.reduce((s, j) => s + j.pos.y, 0) / js.length;
    const chosen = js[centralJunction(scene)].pos;
    const dChosen = (chosen.x - cx) ** 2 + (chosen.y - cy) ** 2;
    for (const j of js) {
      const d = (j.pos.x - cx) ** 2 + (j.pos.y - cy) ** 2;
      expect(d).toBeGreaterThanOrEqual(dChosen - 1e-6);
    }
  });

  it('rush hour is demand-only — no intervention staged', () => {
    expect(preset('rush').stage).toBeUndefined();
    expect(preset('rush').demandRate).toBeGreaterThan(1);
  });

  it('close-the-artery shuts exactly one central road', () => {
    const scene = createScene(0);
    expect(closedCount(scene)).toBe(0);
    preset('artery').stage!(scene);
    expect(closedCount(scene)).toBe(1);
  });

  it('signalize-the-centre enables exactly one signal', () => {
    const scene = createScene(0);
    expect(signalCount(scene)).toBe(0);
    preset('signal').stage!(scene);
    expect(signalCount(scene)).toBe(1);
  });

  it('staging is idempotent — re-applying does not double up', () => {
    const scene = createScene(0);
    preset('artery').stage!(scene);
    preset('artery').stage!(scene);
    expect(closedCount(scene)).toBe(1);
  });

  it('green-wave the artery coordinates one central corridor', () => {
    const scene = createScene(0);
    expect(scene.coordinated.every((s) => s === 0)).toBe(true);
    preset('wave').stage!(scene);
    expect(scene.coordinated.filter((s) => s > 0).length).toBe(1);
    expect(signalCount(scene)).toBeGreaterThanOrEqual(2);
  });

  it('green-wave staging is idempotent', () => {
    const scene = createScene(0);
    preset('wave').stage!(scene);
    const signals = signalCount(scene);
    preset('wave').stage!(scene);
    expect(scene.coordinated.filter((s) => s > 0).length).toBe(1);
    expect(signalCount(scene)).toBe(signals);
  });
});

describe('network presets', () => {
  it('exposes toy → metro at growing scales', () => {
    expect(NETWORKS.map((n) => n.id)).toEqual(['toy', 'block', 'district', 'metro']);
    for (let i = 1; i < NETWORKS.length; i++) {
      expect(NETWORKS[i].grid).toBeGreaterThan(NETWORKS[i - 1].grid);
      expect(NETWORKS[i].capacity).toBeGreaterThanOrEqual(NETWORKS[i - 1].capacity);
    }
  });

  it('each preset builds a scene with its grid², junction count and capacity', () => {
    for (const n of NETWORKS) {
      const scene = createScene(n.demandRate, { grid: n.grid, capacity: n.capacity });
      expect(scene.junctions.length).toBe(n.grid * n.grid);
      expect(n.junctions).toBe(n.grid * n.grid);
      expect(scene.world.agents.capacity).toBe(n.capacity);
    }
  });

  it('capacity gives headroom — the store never overflows under its own demand', () => {
    for (const n of NETWORKS) {
      const scene = createScene(n.demandRate, { grid: n.grid, capacity: n.capacity });
      for (let t = 0; t < 400; t++) tick(scene.world);
      expect(scene.world.agents.activeCount).toBeLessThan(n.capacity);
    }
  });

  it('is deterministic per network (same seed + grid → identical trip count)', () => {
    const run = () => {
      const s = createScene(NETWORKS[2].demandRate, { grid: NETWORKS[2].grid, capacity: NETWORKS[2].capacity });
      for (let t = 0; t < 300; t++) tick(s.world);
      return s.world.metrics.completedTrips;
    };
    expect(run()).toBe(run());
  });
});
