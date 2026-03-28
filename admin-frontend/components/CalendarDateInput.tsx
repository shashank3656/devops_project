import { useRef } from 'react';

interface CalendarDateInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  min?: string;
  max?: string;
  type?: 'date' | 'datetime-local';
}

export default function CalendarDateInput({
  value,
  onChange,
  id,
  min,
  max,
  type = 'date',
}: CalendarDateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch (_) {
        // Fall back to focusing the control when showPicker is unavailable.
      }
    }
    input.focus();
    input.click();
  };

  return (
    <div className="date-input-wrap">
      <input
        ref={inputRef}
        id={id}
        type={type}
        className="input date-input-wrap__input"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="date-input-wrap__button"
        onClick={openPicker}
        aria-label="Open calendar"
        title="Open calendar"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>
    </div>
  );
}
