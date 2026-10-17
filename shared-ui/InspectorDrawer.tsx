import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export default function InspectorDrawer({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  headerActions,
  footer,
  children,
  label,
  resetKey,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  label?: string;
  /** The body scrolls back to the top only when this changes (e.g. the record ID), not on every re-render. */
  resetKey?: string | number | null;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      openerRef.current?.focus();
      openerRef.current = null;
      return;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => {
      document.querySelector<HTMLElement>('.ig-drawer__close')?.focus();
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEditable(event.target)) {
        (event.target as HTMLElement).blur();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) bodyRef.current?.scrollTo({ top: 0 });
  }, [open, resetKey]);

  if (!open) return null;

  return (
    <>
      <div className="ig-drawer__scrim" onClick={onClose} aria-hidden />
      <aside className="ig-drawer" role="complementary" aria-label={label || 'Details'}>
        <header className="ig-drawer__header">
          <div className="ig-drawer__titles">
            {eyebrow ? <span className="ig-eyebrow">{eyebrow}</span> : null}
            <h2 className="ig-drawer__title">{title}</h2>
            {subtitle ? <p className="ig-drawer__subtitle">{subtitle}</p> : null}
          </div>
          <div className="ig-drawer__header-actions">
            {headerActions}
            <button type="button" className="ig-drawer__close" onClick={onClose} aria-label="Close details" title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>
        <div className="ig-drawer__body" ref={bodyRef}>
          {children}
        </div>
        {footer ? <footer className="ig-drawer__footer">{footer}</footer> : null}
      </aside>
    </>
  );
}
