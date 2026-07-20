import type { SweepJob, SweepJobResult } from '@/render/optimize';
import {
  assembleExperiment,
  runExperimentLeg,
  type ExperimentResult,
  type ScenarioConfig,
  type Stats,
} from '@/render/scene';

/**
 * Runs the controlled A/B off the main thread. The two legs — untouched baseline
 * and staged network — are independent full sims, so a `2 min`/`5 min` run is
 * thousands of ticks that would otherwise jank the UI. Each leg is a `sweep.worker`
 * job (the same headless `runJob`, with `raw` selecting the baseline leg); the two
 * dedicated workers here stay separate from the optimizer's shared pool so an A/B
 * and a sweep never contend. Falls back to a synchronous main-thread run where
 * `Worker` is unavailable.
 */

let pool: Worker[] | null | undefined;

function getPool(): Worker[] | null {
  if (pool !== undefined) return pool;
  if (typeof Worker === 'undefined') return (pool = null);
  try {
    pool = Array.from(
      { length: 2 },
      () => new Worker(new URL('./sweep.worker.ts', import.meta.url), { type: 'module' }),
    );
  } catch {
    pool = null;
  }
  return pool;
}

function leg(worker: Worker, job: SweepJob): Promise<Stats> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<SweepJobResult>) => {
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      resolve(e.data.stats);
    };
    const onErr = (e: ErrorEvent) => {
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
      reject(e);
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
    worker.postMessage({ cfg: job.cfg, spec: null, ticks: job.ticks, raw: job.raw } satisfies SweepJob);
  });
}

export function runExperimentPool(cfg: ScenarioConfig, ticks: number): Promise<ExperimentResult> {
  const workers = getPool();
  if (!workers) {
    return Promise.resolve(
      assembleExperiment(cfg, ticks, runExperimentLeg(cfg, ticks, false), runExperimentLeg(cfg, ticks, true)),
    );
  }

  return Promise.all([
    leg(workers[0], { cfg, spec: null, ticks, raw: true }),
    leg(workers[1], { cfg, spec: null, ticks, raw: false }),
  ])
    .then(([baseline, intervention]) => assembleExperiment(cfg, ticks, baseline, intervention))
    .catch(() => {
      for (const w of workers) w.terminate();
      pool = undefined;
      return assembleExperiment(cfg, ticks, runExperimentLeg(cfg, ticks, false), runExperimentLeg(cfg, ticks, true));
    });
}
