import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfirmOptions = {
  title: string;
  message: string;
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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && options ? (
        <div className="ig-confirm-overlay" role="presentation" onClick={() => close(false)}>
          <div
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
