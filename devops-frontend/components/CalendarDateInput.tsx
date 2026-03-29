import { useRef } from 'react';
import { IconCalendar } from './Icons';

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
        <IconCalendar />
      </button>
    </div>
  );
}
