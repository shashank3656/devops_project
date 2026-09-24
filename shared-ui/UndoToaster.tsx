import { useEffect } from 'react';
import type { UndoEntry } from './useUndoQueue';

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export default function UndoToaster({
  entries,
  onUndo,
  onCommit,
  onUndoLatest,
}: {
  entries: UndoEntry[];
  onUndo: (id: string) => void;
  onCommit?: (id: string) => void;
  onUndoLatest?: () => boolean;
}) {
  useEffect(() => {
    if (!onUndoLatest || entries.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z' || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      if (isEditable(event.target)) return;
      if (onUndoLatest()) event.preventDefault();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entries.length, onUndoLatest]);

  if (entries.length === 0) return null;

  return (
    <div className="ig-undo" role="region" aria-label="Pending changes" aria-live="polite">
      {entries.map((entry) => (
        <div key={entry.id} className="ig-undo__toast">
          <span className="ig-undo__message">{entry.message}</span>
          <button type="button" className="ig-undo__action" onClick={() => onUndo(entry.id)}>
            Undo
          </button>
          {onCommit ? (
            <button type="button" className="ig-undo__dismiss" onClick={() => onCommit(entry.id)} aria-label="Apply now">
              ✓
            </button>
          ) : null}
          <span className="ig-undo__timer" style={{ animationDuration: `${entry.durationMs}ms` }} aria-hidden />
        </div>
      ))}
    </div>
  );
}
