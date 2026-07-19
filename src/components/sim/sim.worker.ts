import { tick } from '@/engine';
import { createScene, applyConfig, captureConfig, type Scene, type ScenarioConfig } from '@/render/scene';
import { packFrame } from '@/render/simFrame';
import { carRoute } from '@/render/carTrace';
import { computeSelStats, NONE_SEL, type Selection } from './types';
import { applyCommand, packSignalPhase, WARMUP_TICKS, type SimCommand, type SimEvent } from './simProtocol';

const DT = 0.2;
const MAX_STEPS = 5;
const PUBLISH_MS = 16;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SimCommand>) => void) | null;
  postMessage: (m: SimEvent, transfer?: Transferable[]) => void;
};

let scene: Scene | null = null;
let playing = true;
let speed = 1;
let acc = 0;
let last = 0;
let running = false;
let revision = 0;
let epoch = 0;
let selection: Selection = NONE_SEL;

function post(ev: SimEvent, transfer?: Transferable[]): void {
  ctx.postMessage(ev, transfer);
}

function publishFrame(): void {
  if (!scene) return;
  const frame = packFrame(scene.world);
  post({ type: 'frame', frame, epoch, revision, grid: scene.grid, sigPhase: packSignalPhase(scene) }, [frame.buffer]);
}

function publishSelection(): void {
  if (!scene || selection.kind === 'none') return;
  const stats = computeSelStats(scene, selection);
  const route =
    stats && selection.kind === 'car' ? carRoute(scene.world, selection.id) : null;
  post({ type: 'selection', stats, route: route ? { lanes: route.lanes, idx: route.idx } : null });
}

function loop(): void {
  if (!running) return;
  const now = performance.now();
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  if (scene && playing) {
    acc += dt * speed;
    let n = 0;
    while (acc >= DT && n < MAX_STEPS) {
      tick(scene.world);
      acc -= DT;
      n += 1;
    }
    if (n > 0) {
      publishFrame();
      publishSelection();
    }
  }
  setTimeout(loop, PUBLISH_MS);
}

function build(grid: number, capacity: number, demand: number, config?: ScenarioConfig): void {
  scene = createScene(demand, { grid, capacity });
  if (config) applyConfig(scene, config, true);
}

ctx.onmessage = (e) => {
  const m = e.data;

  if (m.type === 'init' || m.type === 'reset') {
    build(m.grid, m.capacity, m.demand, m.config);
    if (m.type === 'init' && scene) for (let i = 0; i < WARMUP_TICKS; i++) tick(scene.world);
    playing = m.type === 'init' ? (m.playing ?? true) : playing;
    speed = m.type === 'init' ? (m.speed ?? 1) : speed;
    acc = 0;
    last = 0;
    revision = 0;
    epoch += 1;
    if (m.type === 'reset') selection = NONE_SEL;
    const config = captureConfig(scene!);
    post(m.type === 'init' ? { type: 'ready', revision, epoch, config } : { type: 'resetComplete', epoch, config });
    publishFrame();
    if (!running) {
      running = true;
      setTimeout(loop, PUBLISH_MS);
    }
    return;
  }

  if (!scene) return;

  if (m.type === 'setPlaying') {
    playing = m.playing;
    last = 0;
    return;
  }
  if (m.type === 'setSpeed') {
    speed = m.speed;
    return;
  }
  if (m.type === 'fastForward') {
    const n = Math.max(0, Math.min(m.ticks | 0, 6000));
    for (let i = 0; i < n; i++) tick(scene.world);
    acc = 0;
    last = 0;
    publishFrame();
    publishSelection();
    return;
  }
  if (m.type === 'setSelection') {
    selection = m.sel;
    publishSelection();
    return;
  }

  const res = applyCommand(scene, m);
  if (!res.ok) {
    post({ type: 'rejected', id: m.id, reason: res.reason ?? 'rejected' });
    return;
  }
  revision += 1;
  post({ type: 'applied', id: m.id, revision, epoch, config: captureConfig(scene) });
  publishFrame();
  publishSelection();
};
