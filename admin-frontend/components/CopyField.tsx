import { useState } from 'react';
import { copyText } from '../lib/clipboard';

interface CopyFieldProps {
  value: string;
  label?: string;
  buttonLabel?: string;
}

export default function CopyField({ value, label, buttonLabel = 'Copy' }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="admin-copy-field">
      {label ? <span className="admin-copy-field__label">{label}</span> : null}
      <div className="admin-copy-field__row">
        <code>{value}</code>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCopy()}>
          {copied ? 'Copied' : buttonLabel}
        </button>
      </div>
    </div>
  );
}
