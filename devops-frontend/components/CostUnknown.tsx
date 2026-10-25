import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import type { CostUnknownReason } from '../lib/cost';

export default function CostUnknown({
  reason,
  href,
  canOperate,
}: {
  reason: CostUnknownReason;
  href?: string;
  canOperate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const importNeeded = reason.code === 'not_imported' || reason.code === 'stale' || reason.code === 'none' || reason.code === 'incomplete';

  return (
    <>
      <button
        type="button"
        className="cost-unknown__value"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        Unknown
      </button>
      {open ? (
        <div className="cost-unknown" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="cost-unknown__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={titleId}>{reason.title}</h3>
            <p>{reason.detail}</p>
            {importNeeded ? (
              <p>
                {canOperate === false
                  ? 'Ask someone with Cost operate to import.'
                  : <Link href={href || '/cost/configuration'} onClick={() => setOpen(false)}>Import billed lines</Link>}
              </p>
            ) : null}
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
