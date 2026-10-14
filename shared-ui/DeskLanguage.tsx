import type { FormEvent, ReactNode } from 'react';
import {
  deskStateLabel,
  deskSubmitBlock,
  normalizeDeskState,
  type DeskState,
} from './deskRules';

export function DeskStateChip({ value }: { value: unknown }) {
  const state = normalizeDeskState(value);
  return (
    <span className={`ig-chip desk-state desk-state--${state}`} data-state={state}>
      {deskStateLabel(state)}
    </span>
  );
}

export function DeskError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="desk-language__error" role="alert">
      {message}
    </p>
  );
}

export function DeskRecordList<T extends { key: string; label: string; state: unknown }>({
  records,
  emptyLabel,
}: {
  records: readonly T[];
  emptyLabel: string;
}) {
  if (records.length === 0) {
    return (
      <div className="desk-language__empty">
        <DeskStateChip value="empty" />
        <p>{emptyLabel}</p>
      </div>
    );
  }
  return (
    <ul className="desk-language__records">
      {records.map((record) => (
        <li key={record.key}>
          <span>{record.label}</span>
          <DeskStateChip value={record.state} />
        </li>
      ))}
    </ul>
  );
}

export function DeskEnvironmentForm({
  environment,
  canWrite,
  message,
  onEnvironment,
  onSubmit,
  children,
}: {
  environment: string;
  canWrite: boolean;
  message: string;
  onEnvironment: (value: string) => void;
  onSubmit: () => void;
  children?: ReactNode;
}) {
  const block = deskSubmitBlock(canWrite, environment);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (block) return;
    onSubmit();
  }

  return (
    <form className="desk-language__form" onSubmit={handleSubmit}>
      <label htmlFor="desk-environment">Environment</label>
      <input
        id="desk-environment"
        name="environment"
        value={environment}
        autoComplete="off"
        onChange={(event) => onEnvironment(event.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={Boolean(block)}>
        {canWrite ? 'Check environment' : 'Read only'}
      </button>
      <DeskError message={message || block} />
      {children}
    </form>
  );
}
