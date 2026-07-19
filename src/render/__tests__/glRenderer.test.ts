import { describe, it, expect } from 'vitest';
import { packCarInstances, CAR_STRIDE } from '../glRenderer';
import { buildGrid } from '../grid';
import type { RenderCar } from '../renderer';

const car = (over: Partial<RenderCar>): RenderCar => ({
  id: 0,
  key: 0,
  lane: 0,
  s: 10,
  length: 4.5,
  speedFrac: 1,
  ...over,
});

describe('packCarInstances', () => {
  it('packs one instance per car with in-range colour and positive size', () => {
    const { geometry } = buildGrid(3, 3);
    const cars = [car({ lane: 0, speedFrac: 1 }), car({ id: 1, lane: 1, s: 20, speedFrac: 0 })];
    const { data, count } = packCarInstances(geometry, 800, 600, cars, () => 1);

    expect(count).toBe(2);
    expect(data.length).toBeGreaterThanOrEqual(count * CAR_STRIDE);
    for (let i = 0; i < count; i++) {
      const o = i * CAR_STRIDE;
      expect(data[o + 4]).toBeGreaterThan(0); // halfLen
      expect(data[o + 5]).toBeGreaterThan(0); // halfWid
      for (let k = 6; k < 9; k++) {
        expect(data[o + k]).toBeGreaterThanOrEqual(0);
        expect(data[o + k]).toBeLessThanOrEqual(1);
      }
      expect(data[o + 9]).toBe(1); // alpha (no dimming)
    }
  });

  it('gives a moving car a trail and a stopped car none', () => {
    const { geometry } = buildGrid(3, 3);
    const moving = packCarInstances(geometry, 800, 600, [car({ speedFrac: 1 })], () => 1);
    const stopped = packCarInstances(geometry, 800, 600, [car({ speedFrac: 0 })], () => 1);
    expect(moving.data[10]).toBeGreaterThan(0);
    expect(stopped.data[10]).toBe(0);
  });

  it('routes the dim function into the alpha channel (spotlight focus)', () => {
    const { geometry } = buildGrid(3, 3);
    const cars = [car({ lane: 2, s: 5, speedFrac: 0.5 })];
    const { data } = packCarInstances(geometry, 800, 600, cars, (lane) => (lane === 2 ? 0.28 : 1));
    expect(data[9]).toBeCloseTo(0.28, 6);
  });

  it('reuses a provided buffer when it is large enough', () => {
    const { geometry } = buildGrid(2, 2);
    const cars = [car({}), car({ id: 1, lane: 1 })];
    const buf = new Float32Array(64);
    const { data } = packCarInstances(geometry, 400, 400, cars, () => 1, buf);
    expect(data).toBe(buf);
  });
});
