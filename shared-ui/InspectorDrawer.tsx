import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  returnFocusId,
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
  /** Element to focus after close, usually the row that opened the drawer. */
  returnFocusId?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocusId);
  returnFocusRef.current = returnFocusId;

  useEffect(() => {
    if (!open) {
      const returnTo = returnFocusRef.current ? document.getElementById(returnFocusRef.current) : null;
      (returnTo || openerRef.current)?.focus();
      openerRef.current = null;
      return;
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('.ig-drawer__close')?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      const returnTo = returnFocusRef.current ? document.getElementById(returnFocusRef.current) : null;
      (returnTo || openerRef.current)?.focus();
      openerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
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
      <aside className="ig-drawer" ref={panelRef} role="dialog" aria-modal="true" aria-label={label || 'Details'}>
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
