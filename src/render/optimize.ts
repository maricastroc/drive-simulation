import { tick } from '@/engine';
import {
  createScene,
  captureConfig,
  applyConfig,
  sampleStats,
  toggleSignal,
  flipPriority,
  greenWave,
  type Scene,
  type Stats,
  type ScenarioConfig,
} from './scene';

export type CandidateKind = 'signal' | 'priority' | 'greenwave';

export interface CandidateSpec {
  readonly kind: CandidateKind;
  readonly junction: number;
  readonly corridor?: number;
}

export interface Candidate {
  readonly id: string;
  readonly label: string;
  readonly kind: CandidateKind;
  readonly junction: number;
  readonly corridor?: number;
  apply(scene: Scene): void;
}

export function specOf(c: Candidate): CandidateSpec {
  return { kind: c.kind, junction: c.junction, corridor: c.corridor };
}

export function applyCandidate(scene: Scene, spec: CandidateSpec): void {
  if (spec.kind === 'signal') {
    if (scene.signals[spec.junction]?.enabled !== true) toggleSignal(scene, spec.junction);
  } else if (spec.kind === 'priority') {
    flipPriority(scene, spec.junction);
  } else if (spec.kind === 'greenwave' && spec.corridor !== undefined) {
    greenWave(scene, spec.corridor);
  }
}

export function generateCandidates(scene: Scene): Candidate[] {
  const out: Candidate[] = [];
  const { rank } = scene.world.control;
  const conns = scene.world.graph.connections;
  scene.junctions.forEach((j, idx) => {
    const signalized = scene.signals[idx]?.enabled === true;
    const flipped = j.approaches.some((ap) => ap.conns.some((ci) => rank[ci] !== conns[ci].rank));

    if (!signalized) {
      out.push({
        id: `sig:${idx}`,
        label: `Signalize ${j.node}`,
        kind: 'signal',
        junction: idx,
        apply: (s) => applyCandidate(s, { kind: 'signal', junction: idx }),
      });
    }
    if (!signalized && !flipped) {
      out.push({
        id: `pri:${idx}`,
        label: `Flip priority ${j.node}`,
        kind: 'priority',
        junction: idx,
        apply: (s) => applyCandidate(s, { kind: 'priority', junction: idx }),
      });
    }
  });

  scene.corridors.forEach((cor, i) => {
    if (scene.coordinated[i] > 0) return;
    out.push({
      id: `wave:${i}`,
      label: `Green-wave ${cor.label}`,
      kind: 'greenwave',
      junction: cor.junctions[Math.floor(cor.junctions.length / 2)],
      corridor: i,
      apply: (s) => applyCandidate(s, { kind: 'greenwave', junction: 0, corridor: i }),
    });
  });
  return out;
}

export interface Baseline {
  readonly cfg: ScenarioConfig;
  readonly stats: Stats;
}

export interface SweepRow {
  readonly candidate: Candidate;
  readonly stats: Stats;
  readonly tripsDelta: number;
  readonly speedDelta: number;
}

export interface SweepJob {
  readonly cfg: ScenarioConfig;
  readonly spec: CandidateSpec | null;
  readonly ticks: number;
  /** Run the raw network (no staged interventions) — the A/B baseline leg. */
  readonly raw?: boolean;
}

export interface SweepJobResult {
  readonly stats: Stats;
}

export function runJob(cfg: ScenarioConfig, spec: CandidateSpec | null, ticks: number, raw = false): Stats {
  const w = createScene(0, { grid: cfg.grid, capacity: cfg.capacity });
  applyConfig(w, cfg, !raw);
  if (spec) applyCandidate(w, spec);
  for (let n = 0; n < ticks; n++) tick(w.world);
  return sampleStats(w.world);
}

export function deltaRow(candidate: Candidate, stats: Stats, base: Stats): SweepRow {
  return {
    candidate,
    stats,
    tripsDelta: base.completedTrips ? (stats.completedTrips - base.completedTrips) / base.completedTrips : 0,
    speedDelta: base.avgSpeedKmh ? (stats.avgSpeedKmh - base.avgSpeedKmh) / base.avgSpeedKmh : 0,
  };
}

export function sweepBaseline(scene: Scene, ticks: number): Baseline {
  const cfg = captureConfig(scene);
  return { cfg, stats: runJob(cfg, null, ticks) };
}

export function sweepCandidate(base: Baseline, candidate: Candidate, ticks: number): SweepRow {
  return deltaRow(candidate, runJob(base.cfg, specOf(candidate), ticks), base.stats);
}
