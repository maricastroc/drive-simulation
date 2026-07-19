import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeThrottle } from '../simClient';

describe('makeThrottle — slider debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires the first call immediately and coalesces the rest into one trailing call', () => {
    const seen: number[] = [];
    const t = makeThrottle();

    for (const v of [1, 2, 3, 4, 5]) t.run('demand', () => seen.push(v));
    expect(seen).toEqual([1]);

    vi.advanceTimersByTime(70);
    expect(seen).toEqual([1, 5]);

    vi.advanceTimersByTime(200);
    expect(seen).toEqual([1, 5]);
  });

  it('keys are independent (per-lane rates never overwrite each other)', () => {
    const seen: string[] = [];
    const t = makeThrottle();
    t.run('rate:0', () => seen.push('a0'));
    t.run('rate:1', () => seen.push('b0'));
    t.run('rate:0', () => seen.push('a1'));
    t.run('rate:1', () => seen.push('b1'));
    expect(seen).toEqual(['a0', 'b0']);

    vi.advanceTimersByTime(70);
    expect(seen).toEqual(['a0', 'b0', 'a1', 'b1']);
  });

  it('dispose cancels any pending trailing call', () => {
    const seen: number[] = [];
    const t = makeThrottle();
    t.run('demand', () => seen.push(1));
    t.run('demand', () => seen.push(2));
    t.dispose();
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([1]);
  });
});
