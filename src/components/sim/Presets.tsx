import { PRESETS, type Preset } from '@/render/presets';
import { CARD } from './ui';
import { IconBolt } from './icons';

export function Presets({ onApply }: { onApply: (preset: Preset) => void }) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconBolt />
        <div className="eyebrow">Scenario presets</div>
      </div>
      <div className="flex flex-col gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => onApply(p)}
            className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left transition-all duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
          >
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--${p.tone})` }} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-[var(--text-1)]">{p.label}</div>
              <div className="text-[11px] leading-snug text-[var(--text-3)]">{p.desc}</div>
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-3)]">
        One click stages a fresh network — then watch it, or run the A/B.
      </p>
    </section>
  );
}
