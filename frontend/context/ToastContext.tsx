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
    setTimeout(() => removeToast(id), TOAST_DURATION);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '360px',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            style={{
              padding: '14px 18px',
              borderRadius: '10px',
              boxShadow: 'var(--shadow-lg)',
              background: t.type === 'success' ? 'var(--success-bg)' : t.type === 'error' ? 'var(--error-bg)' : 'var(--info-bg)',
              color: t.type === 'success' ? 'var(--success-color)' : t.type === 'error' ? 'var(--error-color)' : 'var(--info-color)',
              border: `1px solid ${t.type === 'success' ? 'var(--success-color)' : t.type === 'error' ? 'var(--error-color)' : 'var(--info-color)'}`,
              fontSize: '14px',
              fontWeight: 500,
              animation: 'toastIn 0.25s ease',
            }}
          >
            {t.message}
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
