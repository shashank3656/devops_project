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
    <div
      className="date-input-wrap"
      style={{ position: 'relative', width: '100%', minHeight: 40, display: 'block' }}
    >
      <input
        ref={inputRef}
        id={id}
        type={type}
        className="input date-input-wrap__input"
        style={{ width: '100%', minHeight: 40, marginBottom: 0, paddingRight: 42, display: 'block' }}
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
        style={{
          position: 'absolute',
          top: '50%',
          right: 12,
          transform: 'translateY(-50%)',
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          margin: 0,
          border: 0,
          background: 'transparent',
          appearance: 'none',
          WebkitAppearance: 'none',
          lineHeight: 1,
        }}
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
