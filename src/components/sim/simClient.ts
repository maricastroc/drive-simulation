import type { ScenarioConfig } from '@/render/scene';
import type { Selection, SelStats } from './types';
import type { CarRouteRef, SimCommand, SimEvent, SimMutation } from './simProtocol';

export interface SimClientConfig {
  readonly grid: number;
  readonly capacity: number;
  readonly demand: number;
  readonly speed: number;
  readonly playing: boolean;
  /** Optional starting scenario (deep-link / preset), applied on the worker at init. */
  readonly config?: ScenarioConfig;
}

export interface SimFrames {
  readonly prev: Float32Array | null;
  readonly cur: Float32Array | null;
  readonly arrival: number;
  readonly speed: number;
  readonly sigPhase: number[];
  /** The grid the current frame was packed at — the caller renders it only against
   *  a matching scene, so a stale frame from a just-swapped network is skipped. */
  readonly grid: number;
}

export interface SelectionMsg {
  readonly stats: SelStats | null;
  readonly route: CarRouteRef | null;
}

export type ControlKind = 'ready' | 'applied' | 'resetComplete';

export interface SimClient {
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  fastForward(ticks: number): void;
  setDemand(demand: number): void;
  setSourceRate(lane: number, rate: number): void;
  setSelection(sel: Selection): void;
  mutate(m: SimMutation): void;
  reset(cfg: SimClientConfig): void;
  frames(): SimFrames;
  selection(): SelectionMsg | null;
  onControl(cb: (config: ScenarioConfig, kind: ControlKind) => void): void;
  dispose(): void;
}

/** Window (ms) that coalesces rapid slider drags into leading + trailing commands. */
const THROTTLE_MS = 70;

/**
 * A per-key leading+trailing throttle: fires the first call immediately, coalesces
 * the rest within the window, and always flushes the latest value. Keeps a dragged
 * demand slider from flooding the worker with a command per input event while still
 * guaranteeing the final position lands.
 */
export function makeThrottle() {
  const slots = new Map<string, { latest: (() => void) | null; timer: ReturnType<typeof setTimeout> | null }>();
  const run = (key: string, fire: () => void) => {
    let s = slots.get(key);
    if (!s) {
      s = { latest: null, timer: null };
      slots.set(key, s);
    }
    if (s.timer === null) {
      fire();
      const tick = () => {
        const slot = slots.get(key)!;
        if (slot.latest) {
          const f = slot.latest;
          slot.latest = null;
          f();
          slot.timer = setTimeout(tick, THROTTLE_MS);
        } else {
          slot.timer = null;
        }
      };
      s.timer = setTimeout(tick, THROTTLE_MS);
    } else {
      s.latest = fire;
    }
  };
  const dispose = () => {
    for (const s of slots.values()) if (s.timer !== null) clearTimeout(s.timer);
    slots.clear();
  };
  return { run, dispose };
}

export function createSimClient(cfg: SimClientConfig): SimClient | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  let prev: Float32Array | null = null;
  let cur: Float32Array | null = null;
  let curEpoch = -1;
  let arrival = 0;
  let speed = cfg.speed;
  let sigPhase: number[] = [];
  let curGrid = cfg.grid;
  let sel: SelectionMsg | null = null;
  let cmdId = 0;
  let controlCb: ((config: ScenarioConfig, kind: ControlKind) => void) | null = null;

  const send = (cmd: SimCommand, transfer?: Transferable[]) => worker.postMessage(cmd, transfer ?? []);
  const mutate = (m: SimMutation) => send({ ...m, id: ++cmdId } as SimCommand);
  const throttle = makeThrottle();

  worker.onmessage = (e: MessageEvent<SimEvent>) => {
    const m = e.data;
    switch (m.type) {
      case 'frame':
        prev = m.epoch === curEpoch ? cur : null;
        cur = m.frame;
        curEpoch = m.epoch;
        curGrid = m.grid;
        arrival = performance.now();
        sigPhase = m.sigPhase;
        break;
      case 'ready':
        controlCb?.(m.config, 'ready');
        break;
      case 'applied':
        controlCb?.(m.config, 'applied');
        break;
      case 'resetComplete':
        controlCb?.(m.config, 'resetComplete');
        break;
      case 'selection':
        sel = { stats: m.stats, route: m.route };
        break;
      case 'rejected':
        console.warn(`[sim] command ${m.id} rejected: ${m.reason}`);
        break;
    }
  };

  send({ type: 'init', grid: cfg.grid, capacity: cfg.capacity, demand: cfg.demand, speed: cfg.speed, playing: cfg.playing, config: cfg.config });

  return {
    setPlaying: (playing) => send({ type: 'setPlaying', playing }),
    setSpeed: (s) => {
      speed = s;
      send({ type: 'setSpeed', speed: s });
    },
    fastForward: (ticks) => send({ type: 'fastForward', ticks }),
    setDemand: (demand) => throttle.run('demand', () => mutate({ type: 'setDemand', demand })),
    setSourceRate: (lane, rate) => throttle.run(`rate:${lane}`, () => mutate({ type: 'setSourceRate', lane, rate })),
    setSelection: (s) => send({ type: 'setSelection', sel: s }),
    mutate,
    reset: (c) => send({ type: 'reset', grid: c.grid, capacity: c.capacity, demand: c.demand, config: c.config }),
    frames: () => ({ prev, cur, arrival, speed, sigPhase, grid: curGrid }),
    selection: () => sel,
    onControl: (cb) => {
      controlCb = cb;
    },
    dispose: () => {
      throttle.dispose();
      worker.terminate();
    },
  };
}
