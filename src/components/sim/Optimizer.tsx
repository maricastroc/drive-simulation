import type { Stats } from '@/render/scene';
import type { SweepRow, Candidate } from '@/render/optimize';
import { CARD } from './ui';
import { IconTarget } from './icons';

const pct = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`;
const toneOf = (d: number) => (d > 0.005 ? 'var(--good)' : d < -0.005 ? 'var(--bad)' : 'var(--text-3)');

export function Optimizer({
  running,
  done,
  total,
  result,
  onRun,
  onStage,
}: {
  running: boolean;
  done: number;
  total: number;
  result: { baseline: Stats; rows: SweepRow[] } | null;
  onRun: () => void;
  onStage: (c: Candidate) => void;
}) {
  const best = result?.rows[0];
  const helps = !!best && best.tripsDelta > 0.005;

  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-1 flex items-center gap-2">
        <IconTarget />
        <div className="eyebrow">Optimizer</div>
      </div>
      <p className="mb-3 text-[11.5px] leading-snug text-[var(--text-3)]">
        Tests signalizing and flipping priority at every junction — same seed, same demand — and ranks what moves throughput.
      </p>

      {!result && (
        <button
          onClick={onRun}
          disabled={running}
          className={`w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 disabled:cursor-not-allowed ${
            running ? 'bg-[var(--surface-2)] text-[var(--text-2)]' : 'bg-[var(--accent)] text-white hover:brightness-110'
          }`}
        >
          {running ? `Testing ${done}/${total}…` : 'Find the best fix'}
        </button>
      )}

      {running && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-150" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      )}

      {result && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Ranked vs baseline</span>
            <button onClick={onRun} disabled={running} className="eyebrow text-[var(--accent-2)] transition-colors hover:text-[var(--accent)] disabled:opacity-40">
              {running ? `${done}/${total}` : 'Rerun'}
            </button>
          </div>

          {!helps && (
            <p className="mb-2 text-[11.5px] leading-snug text-[var(--warn)]">
              No single fix beats the baseline at this demand — add load (Rush hour) and rerun.
            </p>
          )}

          <div className="flex flex-col gap-1">
            {result.rows.slice(0, 6).map((row, i) => {
              const top = i === 0 && helps;
              return (
                <button
                  key={row.candidate.id}
                  onClick={() => onStage(row.candidate)}
                  title="Stage this on the live network"
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    top ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/40' : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <span className="tnum w-4 shrink-0 text-center text-[11px] font-bold text-[var(--text-3)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-1)]">{row.candidate.label}</span>
                  <span className="tnum text-[12px] font-semibold" style={{ color: toneOf(row.tripsDelta) }}>
                    {pct(row.tripsDelta)}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-3)]">
            Δ trips over 1 sim-min vs. {result.baseline.completedTrips} baseline. Click a fix to stage it, then run the A/B to confirm.
          </p>
        </div>
      )}
    </section>
  );
}
