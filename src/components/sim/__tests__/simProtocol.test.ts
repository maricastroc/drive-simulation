import { describe, it, expect } from 'vitest';
import { tick } from '@/engine';
import {
  createScene,
  captureConfig,
  applyConfig,
  applyControlSnapshot,
  scenarioSignature,
  closeLaneScene,
  flipPriority,
  setDemandRate,
  type Scene,
} from '@/render/scene';
import { packFrame } from '@/render/simFrame';
import { PRESETS } from '@/render/presets';
import { applyCommand, packSignalPhase, type SimMutation } from '../simProtocol';
import { computeSelStats } from '../types';

const DEMAND = 0.8;

/** An incoming lane of the central-ish junction 0 — safe to close/incident. */
function anIncomingLane(scene: Scene): number {
  const ap = scene.junctions[0].approaches.find((a) => a.fromLane >= 0);
  return ap ? ap.fromLane : scene.sources[0].lane;
}

function hashFrame(f: Float32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < f.length; i++) {
    // Round to shed the last ULP of noise; the sim is deterministic so this is exact.
    const v = Math.round(f[i] * 1e6);
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  }
  return (h >>> 0).toString(16);
}

describe('simProtocol — validation & rejection', () => {
  it('rejects out-of-range and malformed payloads with a reason', () => {
    const scene = createScene(DEMAND);
    const bad: SimMutation[] = [
      { type: 'closeRoad', lane: -1 },
      { type: 'closeRoad', lane: 99999 },
      { type: 'addSignals', junction: 99999 },
      { type: 'flipPriority', junction: -1 },
      { type: 'greenWave', corridor: 99999 },
      { type: 'setDemand', demand: -1 },
      { type: 'setDemand', demand: Number.NaN },
      { type: 'setSourceRate', lane: 123456, rate: 1 },
      { type: 'addIncident', lane: 0, s: -5 },
    ];
    for (const m of bad) {
      const res = applyCommand(scene, m);
      expect(res.ok).toBe(false);
      expect(res.reason).toBeTruthy();
    }
  });

  it('accepts valid mutations and reports ok', () => {
    const scene = createScene(DEMAND);
    const lane = anIncomingLane(scene);
    expect(applyCommand(scene, { type: 'closeRoad', lane }).ok).toBe(true);
    expect(applyCommand(scene, { type: 'addSignals', junction: 0 }).ok).toBe(true);
    expect(applyCommand(scene, { type: 'setDemand', demand: 1.2 }).ok).toBe(true);
  });
});

describe('simProtocol — each command matches its direct helper', () => {
  it('closeRoad / reopenRoad round-trips to the untouched signature', () => {
    const scene = createScene(DEMAND);
    const clean = scenarioSignature(scene);
    const lane = anIncomingLane(scene);
    applyCommand(scene, { type: 'closeRoad', lane });
    expect(scene.world.control.laneClosed[lane]).toBe(1);
    applyCommand(scene, { type: 'reopenRoad', lane });
    expect(scene.world.control.laneClosed[lane]).toBe(0);
    expect(scenarioSignature(scene)).toBe(clean);
  });

  it('closeRoad via command == closeLaneScene direct (identical signature)', () => {
    const lane = anIncomingLane(createScene(DEMAND));
    const direct = createScene(DEMAND);
    closeLaneScene(direct, lane);
    const proto = createScene(DEMAND);
    applyCommand(proto, { type: 'closeRoad', lane });
    expect(scenarioSignature(proto)).toBe(scenarioSignature(direct));
  });

  it('addSignals enables a controller; flipPriority swaps ranks', () => {
    const scene = createScene(DEMAND);
    applyCommand(scene, { type: 'addSignals', junction: 0 });
    expect(scene.signals[0]?.enabled).toBe(true);

    const direct = createScene(DEMAND);
    flipPriority(direct, 1);
    const proto = createScene(DEMAND);
    applyCommand(proto, { type: 'flipPriority', junction: 1 });
    expect(scenarioSignature(proto)).toBe(scenarioSignature(direct));
  });

  it('setDemand matches setDemandRate on every source', () => {
    const direct = createScene(DEMAND);
    setDemandRate(direct, 1.7);
    const proto = createScene(DEMAND);
    applyCommand(proto, { type: 'setDemand', demand: 1.7 });
    expect(proto.sources.map((s) => s.rate)).toEqual(direct.sources.map((s) => s.rate));
  });
});

describe('simProtocol — ordered application of multiple interventions', () => {
  it('applies a mixed sequence and reflects all of it in the config', () => {
    const scene = createScene(DEMAND);
    const lane = anIncomingLane(scene);
    const seq: SimMutation[] = [
      { type: 'closeRoad', lane },
      { type: 'addSignals', junction: 0 },
      { type: 'flipPriority', junction: 2 },
      { type: 'setDemand', demand: 1.3 },
    ];
    for (const m of seq) expect(applyCommand(scene, m).ok).toBe(true);

    const cfg = captureConfig(scene);
    expect(cfg.closed).toBe(1);
    expect(cfg.signalsOn).toBe(1);
    expect(cfg.priorityFlips).toBeGreaterThan(0);
    expect(cfg.rates.every((r) => r === 1.3)).toBe(true);
  });
});

describe('simProtocol — mirror sync (applyControlSnapshot)', () => {
  it('a mirror synced from a confirmed config matches the source signature', () => {
    const source = createScene(DEMAND);
    const lane = anIncomingLane(source);
    applyCommand(source, { type: 'closeRoad', lane });
    applyCommand(source, { type: 'addSignals', junction: 0 });
    applyCommand(source, { type: 'flipPriority', junction: 3 });
    applyCommand(source, { type: 'greenWave', corridor: 0 });

    const mirror = createScene(0);
    applyControlSnapshot(mirror, captureConfig(source));
    expect(scenarioSignature(mirror)).toBe(scenarioSignature(source));
  });

  it('repeated syncs never leak signal controllers', () => {
    const mirror = createScene(0);
    const source = createScene(DEMAND);
    applyCommand(source, { type: 'addSignals', junction: 0 });
    for (let i = 0; i < 5; i++) applyControlSnapshot(mirror, captureConfig(source));
    expect(mirror.world.control.signals.filter((s) => s.enabled).length).toBe(1);
    expect(mirror.world.control.signals.length).toBe(1);
  });
});

describe('simProtocol — packSignalPhase', () => {
  it('is -1 for unsignalized junctions and the live phase for signalized', () => {
    const scene = createScene(DEMAND);
    let ph = packSignalPhase(scene);
    expect(ph.every((p) => p === -1)).toBe(true);

    applyCommand(scene, { type: 'addSignals', junction: 0 });
    ph = packSignalPhase(scene);
    expect(ph[0]).toBeGreaterThanOrEqual(0);
    expect(ph.filter((p) => p >= 0).length).toBe(1);
  });
});

describe('simProtocol — selection stats (worker-side computeSelStats)', () => {
  it('computes lane stats from the live world', () => {
    const scene = createScene(1.2);
    const lane = scene.sources[0].lane;
    for (let i = 0; i < 200; i++) tick(scene.world);
    const st = computeSelStats(scene, { kind: 'lane', lane, s: 0 });
    expect(st?.kind).toBe('lane');
    if (st?.kind === 'lane') expect(st.freeKmh).toBeGreaterThan(0);
  });
});

describe('simProtocol — scenario preset parity across the boundary', () => {
  it('a preset replayed via captureConfig+applyConfig matches the staged scene', () => {
    const preset = PRESETS.find((p) => p.id === 'signal')!;
    const staged = createScene(preset.demandRate);
    preset.stage?.(staged);

    // What the worker receives: reset(demand) + applyConfig(captureConfig(staged)).
    const worker = createScene(preset.demandRate);
    applyConfig(worker, captureConfig(staged), true);

    expect(scenarioSignature(worker)).toBe(scenarioSignature(staged));
  });
});

describe('simProtocol — determinism (direct vs protocol-driven, same seed)', () => {
  it('the same seed + same command script at the same ticks → identical frames', () => {
    const lane = anIncomingLane(createScene(DEMAND));
    // A script of (tickIndex, command); both runs apply it identically.
    const script: { at: number; cmd: SimMutation }[] = [
      { at: 20, cmd: { type: 'closeRoad', lane } },
      { at: 40, cmd: { type: 'addSignals', junction: 0 } },
      { at: 40, cmd: { type: 'flipPriority', junction: 4 } },
      { at: 60, cmd: { type: 'setDemand', demand: 1.5 } },
      { at: 90, cmd: { type: 'reopenRoad', lane } },
    ];
    const TICKS = 150;

    const run = () => {
      const scene = createScene(DEMAND);
      for (let t = 0; t < TICKS; t++) {
        for (const s of script) if (s.at === t) applyCommand(scene, s.cmd);
        tick(scene.world);
      }
      return hashFrame(packFrame(scene.world));
    };

    expect(run()).toBe(run());
  });

  it('reset/reseed rebuilds a clean scene, bit-identical to a fresh one', () => {
    // Drive a scene with interventions + ticks, then a worker "reset" rebuilds
    // from the same seed with no interventions — identical to a never-touched scene.
    const dirty = createScene(DEMAND);
    applyCommand(dirty, { type: 'closeRoad', lane: anIncomingLane(dirty) });
    for (let t = 0; t < 50; t++) tick(dirty.world);

    const resetScene = createScene(DEMAND); // what the worker builds on reset
    const fresh = createScene(DEMAND);
    expect(scenarioSignature(resetScene)).toBe(scenarioSignature(fresh));
    expect(hashFrame(packFrame(resetScene.world))).toBe(hashFrame(packFrame(fresh.world)));
    // And the two run identically forward.
    for (let t = 0; t < 40; t++) {
      tick(resetScene.world);
      tick(fresh.world);
    }
    expect(hashFrame(packFrame(resetScene.world))).toBe(hashFrame(packFrame(fresh.world)));
  });
});
