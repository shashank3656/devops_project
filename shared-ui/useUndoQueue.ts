import { useCallback, useEffect, useRef, useState } from 'react';

export interface UndoEntry {
  id: string;
  message: string;
  durationMs: number;
}

export interface UndoRequest {
  message: string;
  /** Sends the change. Runs once the undo window closes, or immediately on flush. */
  commit: () => Promise<void> | void;
  /** Restores optimistic UI state when the user undoes or the commit fails. */
  revert?: () => void;
  onError?: (err: unknown) => void;
  onCommitted?: () => void;
}

interface PendingEntry extends UndoRequest {
  id: string;
  timer: number;
}

let sequence = 0;

export default function useUndoQueue(durationMs = 6000) {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const pending = useRef(new Map<string, PendingEntry>());

  const remove = useCallback((id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const commitNow = useCallback(
    async (id: string) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      pending.current.delete(id);
      remove(id);
      try {
        await entry.commit();
        entry.onCommitted?.();
      } catch (err) {
        entry.revert?.();
        entry.onError?.(err);
      }
    },
    [remove],
  );

  const schedule = useCallback(
    (request: UndoRequest) => {
      sequence += 1;
      const id = `undo-${Date.now()}-${sequence}`;
      const timer = window.setTimeout(() => {
        void commitNow(id);
      }, durationMs);
      pending.current.set(id, { ...request, id, timer });
      setEntries((current) => [...current, { id, message: request.message, durationMs }]);
      return id;
    },
    [commitNow, durationMs],
  );

  const undo = useCallback(
    (id: string) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      pending.current.delete(id);
      remove(id);
      entry.revert?.();
    },
    [remove],
  );

  const undoLatest = useCallback(() => {
    const ids = Array.from(pending.current.keys());
    const latest = ids[ids.length - 1];
    if (latest) undo(latest);
    return Boolean(latest);
  }, [undo]);

  const flush = useCallback(() => {
    Array.from(pending.current.keys()).forEach((id) => {
      void commitNow(id);
    });
  }, [commitNow]);

  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flush]);

  return { entries, schedule, undo, undoLatest, commitNow, flush, hasPending: entries.length > 0 };
}
