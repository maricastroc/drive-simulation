import {
  setSourceRate,
  toggleDestination,
  closeLaneScene,
  reopenLaneScene,
  addIncidentScene,
  removeIncidentScene,
  addSignalsScene,
  removeSignalsScene,
  flipPriority,
  greenWave,
  setDemandRate,
  clearInterventions,
  type Scene,
  type ScenarioConfig,
} from '@/render/scene';
import type { Selection, SelStats } from './types';

/**
 * The typed command/event protocol for the interactive Web-Worker simulation
 * (§28 increment 2). The worker owns the authoritative `World`; the main thread
 * sends commands and renders confirmed state. Every mutating command carries a
 * monotonic `id`; the worker replies `applied`/`rejected` and echoes the confirmed
 * `ScenarioConfig` so the main-thread mirror can never drift.
 */

/** Deterministic warm-up applied once when the ambient sim first boots, so the
 *  city opens mid-flow instead of an empty grid that takes ~50s to fill. Same
 *  seed, fixed tick count — reproducible. Not applied on reset / preset / demo,
 *  which intentionally start from a clean network. */
export const WARMUP_TICKS = 200;

export interface CarRouteRef {
  readonly lanes: number[];
  readonly idx: number;
}

/** main thread → worker */
export type SimCommand =
  | { readonly type: 'init'; readonly grid: number; readonly capacity: number; readonly demand: number; readonly speed: number; readonly playing: boolean; readonly config?: ScenarioConfig }
  | { readonly type: 'reset'; readonly grid: number; readonly capacity: number; readonly demand: number; readonly config?: ScenarioConfig }
  | { readonly type: 'setPlaying'; readonly playing: boolean }
  | { readonly type: 'setSpeed'; readonly speed: number }
  | { readonly type: 'fastForward'; readonly ticks: number }
  | { readonly type: 'setSelection'; readonly sel: Selection }
  | ({ readonly id: number } & SimMutation);

/** The mutating subset — each is confirmed with a `revision` bump. */
export type SimMutation =
  | { readonly type: 'setDemand'; readonly demand: number }
  | { readonly type: 'setSourceRate'; readonly lane: number; readonly rate: number }
  | { readonly type: 'toggleDestination'; readonly lane: number; readonly sink: number }
  | { readonly type: 'closeRoad'; readonly lane: number }
  | { readonly type: 'reopenRoad'; readonly lane: number }
  | { readonly type: 'addIncident'; readonly lane: number; readonly s: number }
  | { readonly type: 'removeIncident'; readonly lane: number }
  | { readonly type: 'addSignals'; readonly junction: number }
  | { readonly type: 'removeSignals'; readonly junction: number }
  | { readonly type: 'flipPriority'; readonly junction: number }
  | { readonly type: 'greenWave'; readonly corridor: number }
  | { readonly type: 'clearInterventions' };

/** worker → main thread */
export type SimEvent =
  | { readonly type: 'ready'; readonly revision: number; readonly epoch: number; readonly config: ScenarioConfig }
  | { readonly type: 'frame'; readonly frame: Float32Array; readonly epoch: number; readonly revision: number; readonly grid: number; readonly sigPhase: number[]; readonly tickMs: number }
  | { readonly type: 'applied'; readonly id: number; readonly revision: number; readonly epoch: number; readonly config: ScenarioConfig }
  | { readonly type: 'rejected'; readonly id: number; readonly reason: string }
  | { readonly type: 'selection'; readonly stats: SelStats | null; readonly route: CarRouteRef | null }
  | { readonly type: 'resetComplete'; readonly epoch: number; readonly config: ScenarioConfig };

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
}

const laneInRange = (scene: Scene, lane: number): boolean =>
  Number.isInteger(lane) && lane >= 0 && lane < scene.world.graph.laneCount;
const junctionInRange = (scene: Scene, j: number): boolean =>
  Number.isInteger(j) && j >= 0 && j < scene.junctions.length;
const corridorInRange = (scene: Scene, i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < scene.corridors.length;
const finiteRate = (r: number): boolean => Number.isFinite(r) && r >= 0;

/**
 * Validate + apply one mutation against the authoritative scene. Pure of any
 * worker/DOM concern (takes a `Scene`), so it unit-tests in Node and is the single
 * source of truth for how a command mutates the world — the same `scene.ts` helpers
 * the main-thread Inspector calls directly in non-worker mode. Returns a
 * confirmation/rejection; the caller bumps the revision only when `ok`.
 */
export function applyCommand(scene: Scene, cmd: SimMutation): CommandResult {
  switch (cmd.type) {
    case 'setDemand':
      if (!finiteRate(cmd.demand)) return { ok: false, reason: 'invalid demand' };
      setDemandRate(scene, cmd.demand);
      return { ok: true };
    case 'setSourceRate': {
      if (!finiteRate(cmd.rate)) return { ok: false, reason: 'invalid rate' };
      const ctl = scene.sources.find((s) => s.lane === cmd.lane);
      if (!ctl) return { ok: false, reason: 'not an entry' };
      setSourceRate(scene, ctl, cmd.rate);
      return { ok: true };
    }
    case 'toggleDestination': {
      const ctl = scene.sources.find((s) => s.lane === cmd.lane);
      if (!ctl) return { ok: false, reason: 'not an entry' };
      if (!ctl.reachable.includes(cmd.sink)) return { ok: false, reason: 'unreachable sink' };
      toggleDestination(scene, ctl, cmd.sink);
      return { ok: true };
    }
    case 'closeRoad':
      if (!laneInRange(scene, cmd.lane)) return { ok: false, reason: 'lane out of range' };
      closeLaneScene(scene, cmd.lane);
      return { ok: true };
    case 'reopenRoad':
      if (!laneInRange(scene, cmd.lane)) return { ok: false, reason: 'lane out of range' };
      reopenLaneScene(scene, cmd.lane);
      return { ok: true };
    case 'addIncident':
      if (!laneInRange(scene, cmd.lane)) return { ok: false, reason: 'lane out of range' };
      if (!Number.isFinite(cmd.s) || cmd.s < 0) return { ok: false, reason: 'invalid position' };
      addIncidentScene(scene, cmd.lane, cmd.s);
      return { ok: true };
    case 'removeIncident':
      if (!laneInRange(scene, cmd.lane)) return { ok: false, reason: 'lane out of range' };
      removeIncidentScene(scene, cmd.lane);
      return { ok: true };
    case 'addSignals':
      if (!junctionInRange(scene, cmd.junction)) return { ok: false, reason: 'junction out of range' };
      addSignalsScene(scene, cmd.junction);
      return { ok: true };
    case 'removeSignals':
      if (!junctionInRange(scene, cmd.junction)) return { ok: false, reason: 'junction out of range' };
      removeSignalsScene(scene, cmd.junction);
      return { ok: true };
    case 'flipPriority':
      if (!junctionInRange(scene, cmd.junction)) return { ok: false, reason: 'junction out of range' };
      flipPriority(scene, cmd.junction);
      return { ok: true };
    case 'greenWave':
      if (!corridorInRange(scene, cmd.corridor)) return { ok: false, reason: 'corridor out of range' };
      greenWave(scene, cmd.corridor);
      return { ok: true };
    case 'clearInterventions':
      clearInterventions(scene);
      return { ok: true };
  }
}

/** Per-junction signal phase for the frame (`-1` where a junction is unsignalized). */
export function packSignalPhase(scene: Scene): number[] {
  return scene.signals.map((s) => (s?.enabled ? s.phase : -1));
}
