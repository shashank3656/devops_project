import type { KeyboardEvent } from 'react';

export interface SegmentedOption {
  value: string;
  label: string;
  hint?: string;
}

export default function SegmentedControl({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  name?: string;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(Math.max(0, selectedIndex) + step + options.length) % options.length];
    onChange(next.value);
    const target = event.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
    target?.focus();
  };

  return (
    <div className="ig-segmented" role="radiogroup" aria-label={label} onKeyDown={handleKeyDown}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            data-value={option.value}
            aria-checked={checked}
            tabIndex={checked || (selectedIndex === -1 && index === 0) ? 0 : -1}
            className={`ig-segmented__option${checked ? ' is-active' : ''}`}
            onClick={() => onChange(option.value)}
            title={option.hint}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
