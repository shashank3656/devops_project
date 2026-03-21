import { useRef } from 'react';
import { IconCalendar } from './Icons';

interface CalendarDateInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  min?: string;
}

export default function CalendarDateInput({ value, onChange, id, min }: CalendarDateInputProps) {
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
        type="date"
        className="input date-input-wrap__input"
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="date-input-wrap__button"
        onClick={openPicker}
        aria-label="Open calendar"
        title="Open calendar"
      >
        <IconCalendar />
      </button>
    </div>
  );
}
