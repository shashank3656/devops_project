import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfirmOptions = {
  title: string;
  message: string;
  detailLines?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<(value: boolean) => void>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    setOpen(false);
    setOptions(null);
    resolverRef.current?.(value);
    resolverRef.current = undefined;
  };

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const focusables = () => Array.from(root?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || []).filter((node) => !node.hasAttribute('disabled'));
    window.requestAnimationFrame(() => focusables()[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && options ? (
        <div className="ig-confirm-overlay" role="presentation" onClick={() => close(false)}>
          <div
            ref={dialogRef}
            className="ig-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ig-confirm-title"
            aria-describedby="ig-confirm-message"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="ig-confirm-title" className="ig-confirm__title">
              {options.title}
            </h2>
            <p id="ig-confirm-message" className="ig-confirm__message">
              {options.message}
            </p>
            {options.detailLines && options.detailLines.length > 0 ? (
              <ul className="ig-confirm__details">
                {options.detailLines.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            ) : null}
            <div className="ig-confirm__actions">
              <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
                {options.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                className={options.destructive ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => close(true)}
              >
                {options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    return (opts) => Promise.resolve(window.confirm(`${opts.title}\n\n${opts.message}`));
  }
  return ctx;
}
