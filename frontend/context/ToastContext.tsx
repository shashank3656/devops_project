import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), type === 'error' ? TOAST_DURATION * 2 : TOAST_DURATION);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="ig-toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'} className={`ig-toast ig-toast--${t.type}`}>
            <span className="ig-toast__dot" aria-hidden />
            <span className="ig-toast__message">{t.message}</span>
            <button type="button" className="ig-toast__close" onClick={() => removeToast(t.id)} aria-label="Dismiss notification">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: (msg: string) => console.log('[Toast]', msg),
    };
  }
  return ctx;
}
