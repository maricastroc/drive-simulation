import {
  runJob,
  deltaRow,
  specOf,
  type Candidate,
  type CandidateSpec,
  type SweepRow,
  type SweepJob,
  type SweepJobResult,
} from '@/render/optimize';
import type { ScenarioConfig, Stats } from '@/render/scene';

const CHUNK = 2;

function poolSize(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min((hc ?? 4) - 1, 8));
}

let pool: Worker[] | null | undefined;

function getPool(): Worker[] | null {
  if (pool !== undefined) return pool;
  if (typeof Worker === 'undefined') return (pool = null);
  try {
    pool = Array.from(
      { length: poolSize() },
      () => new Worker(new URL('./sweep.worker.ts', import.meta.url), { type: 'module' }),
    );
  } catch {
    pool = null;
  }
  return pool;
}

export interface SweepOutcome {
  readonly baseStats: Stats;
  readonly rows: SweepRow[];
}

function assemble(candidates: Candidate[], stats: Stats[]): SweepOutcome {
  const baseStats = stats[0];
  const rows = candidates
    .map((c, i) => deltaRow(c, stats[i + 1], baseStats))
    .sort((a, b) => b.tripsDelta - a.tripsDelta || b.speedDelta - a.speedDelta);
  return { baseStats, rows };
}

export function runSweepPool(
  cfg: ScenarioConfig,
  candidates: Candidate[],
  ticks: number,
  onProgress: (done: number, total: number) => void,
): Promise<SweepOutcome> {
  const specs: (CandidateSpec | null)[] = [null, ...candidates.map(specOf)];
  const total = specs.length;
  const stats: Stats[] = new Array(total);
  const workers = getPool();

  return new Promise((resolve) => {
    let done = 0;
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(assemble(candidates, stats));
      }
    };

    // Compute any job still missing a result on the main thread (no workers, or a
    // worker died mid-sweep). Chunked so it never blocks the frame loop.
    const drain = () => {
      let i = 0;
      const step = () => {
        for (let c = 0; c < CHUNK && i < total; c++, i++) {
          if (stats[i] === undefined) {
            stats[i] = runJob(cfg, specs[i], ticks);
            done += 1;
          }
        }
        onProgress(done, total);
        if (i < total) setTimeout(step, 0);
        else finish();
      };
      step();
    };

    if (!workers) return drain();

    let next = 0;
    let broken = false;
    const runOn = (w: Worker) => {
      if (broken || next >= total) return;
      const idx = next++;
      const onMsg = (e: MessageEvent<SweepJobResult>) => {
        w.removeEventListener('message', onMsg);
        w.removeEventListener('error', onErr);
        stats[idx] = e.data.stats;
        done += 1;
        onProgress(done, total);
        if (done === total) finish();
        else runOn(w);
      };
      const onErr = () => {
        w.removeEventListener('message', onMsg);
        w.removeEventListener('error', onErr);
        if (broken) return;
        broken = true;
        for (const x of workers) x.terminate();
        pool = null;
        drain();
      };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr);
      w.postMessage({ cfg, spec: specs[idx], ticks } satisfies SweepJob);
    };
    for (const w of workers) runOn(w);
  });
}
