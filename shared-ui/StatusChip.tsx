import type { RiskLevel } from './types';

const LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ok: 'Clear',
  info: 'Live',
  danger: 'Blocked',
};

export default function StatusChip({ tone, label }: { tone?: RiskLevel | 'ok' | 'info' | 'danger'; label?: string }) {
  const resolved = tone || 'info';
  return <span className={`ig-chip ig-chip--${resolved}`}>{label || LABELS[resolved] || resolved}</span>;
}
