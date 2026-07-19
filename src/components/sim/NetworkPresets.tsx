import { NETWORKS, type NetworkPreset } from '@/render/presets';
import { CARD } from './ui';
import { IconGrid } from './icons';

export function NetworkPresets({
  activeGrid,
  onApply,
}: {
  activeGrid: number;
  onApply: (net: NetworkPreset) => void;
}) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconGrid />
        <div className="eyebrow">Network</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {NETWORKS.map((n) => {
          const active = n.grid === activeGrid;
          return (
            <button
              key={n.id}
              onClick={() => onApply(n)}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-2.5 text-left transition-all duration-150 ${
                active
                  ? 'border-(--accent)/45 bg-(--accent-soft)'
                  : 'border-(--border) bg-(--surface-2) hover:border-(--border-strong) hover:bg-(--surface-3)'
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className={`text-[12.5px] font-semibold ${active ? 'text-(--accent-2)' : 'text-(--text-1)'}`}>
                  {n.label}
                </span>
                <span className="tnum text-[10px] text-(--text-3)">{n.grid}×{n.grid}</span>
              </div>
              <div className="tnum text-[10.5px] text-(--text-3)">{n.junctions} junctions</div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-(--text-3)">
        Swap the whole grid — same seed, same engine, more city. Demand holds so you read how scale
        alone changes the flow.
      </p>
    </section>
  );
}
