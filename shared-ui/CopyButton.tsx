import { useState } from 'react';

export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const text = value.trim();
  if (!text) return null;
  return (
    <button
      type="button"
      className="copy-chip"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => setCopied(false));
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
