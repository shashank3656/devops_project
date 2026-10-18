import { useState } from 'react';

export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const text = value.trim();
  if (!text) return null;
  return (
    <button
      type="button"
      className="copy-chip"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="3.5" width="7" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.5 5.5v7.2c0 .7.5 1.3 1.2 1.3H10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
