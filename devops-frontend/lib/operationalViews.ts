import type { SavedView } from '@infragate/ui';

export const OPERATIONS_SCOPE = 'operations';
export const OPERATIONS_STORAGE_KEY = 'opstrellis.operations.views';

export type OperationalView = {
  team: string;
  environment: string;
  mine: string;
  unassigned: string;
};

export const OPERATIONS_VIEW_PRESETS: SavedView<OperationalView>[] = [
  { name: 'My team · Production · Unassigned', filters: { team: 'mine', environment: 'prod', mine: '', unassigned: '1' } },
];

export function emptyOperationalView(): OperationalView {
  return { team: '', environment: '', mine: '', unassigned: '' };
}

export function asOperationalView(value: Partial<OperationalView> | null | undefined): OperationalView {
  return {
    team: String(value?.team || ''),
    environment: String(value?.environment || ''),
    mine: value?.mine === '1' ? '1' : '',
    unassigned: value?.unassigned === '1' ? '1' : '',
  };
}

export function environmentMatches(actual: string | undefined, wanted: string): boolean {
  if (!wanted) return true;
  const env = (actual || '').trim().toLowerCase();
  const filter = wanted.trim().toLowerCase();
  if (!filter) return true;
  if (!env) return true;
  if (filter === 'prod' || filter === 'production') return env.startsWith('prod');
  if (filter === 'dev' || filter === 'development') return env === 'dev' || env.startsWith('dev');
  return env === filter;
}

export function operationalViewLabels(view: OperationalView): string[] {
  const labels: string[] = [];
  if (view.team === 'mine') labels.push('My team');
  else if (view.team) labels.push(view.team);
  const env = view.environment.trim().toLowerCase();
  if (env === 'prod' || env === 'production') labels.push('Production');
  else if (view.environment) labels.push(view.environment);
  if (view.mine === '1') labels.push('My shifts');
  if (view.unassigned === '1') labels.push('Unassigned');
  return labels;
}
