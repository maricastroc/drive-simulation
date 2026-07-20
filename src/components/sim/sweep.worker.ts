import { runJob, type SweepJob, type SweepJobResult } from '@/render/optimize';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SweepJob>) => void) | null;
  postMessage: (m: SweepJobResult) => void;
};

ctx.onmessage = (e) => {
  const { cfg, spec, ticks, raw } = e.data;
  ctx.postMessage({ stats: runJob(cfg, spec, ticks, raw) });
};
