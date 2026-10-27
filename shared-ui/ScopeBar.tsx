import { useMemo } from 'react';
import { defaultEnvironmentForProject, type ScopeProject, type WorkspaceScope } from './useWorkspaceScope';

const FALLBACK_ENVIRONMENTS = ['dev', 'uat', 'prod'];

export default function ScopeBar({
  projects,
  scope,
  onChange,
  onClear,
  catalogEnvironments,
  showFacts = false,
}: {
  projects: ScopeProject[];
  scope: WorkspaceScope;
  onChange: (next: Partial<WorkspaceScope>) => void;
  onClear?: () => void;
  /** NF-03: when set for the selected project, overrides project.environments */
  catalogEnvironments?: string[];
  /** Review screens keep the full project, team, and environment visible. */
  showFacts?: boolean;
}) {
  const selected = useMemo(
    () => projects.find((project) => String(project.id) === String(scope.projectId)) || null,
    [projects, scope.projectId],
  );
  const environments = useMemo(() => {
    const fromCatalog = (catalogEnvironments || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (scope.projectId && fromCatalog.length) {
      return Array.from(new Set(fromCatalog));
    }
    const fromProject = selected?.environments?.length ? selected.environments : [];
    const fromAll = projects.flatMap((project) => project.environments || []);
    const unique = Array.from(new Set((fromProject.length ? fromProject : fromAll).map((item) => String(item || '').trim()).filter(Boolean)));
    return unique.length ? unique : FALLBACK_ENVIRONMENTS;
  }, [projects, selected, catalogEnvironments, scope.projectId]);
  const environmentName = typeof scope?.environment === 'string' ? scope.environment : '';
  const hasScope = Boolean(scope?.projectId || environmentName);
  const projectLabel = selected
    ? (selected.code ? `${selected.name} (${selected.code})` : selected.name || 'Project')
    : 'All projects';
  const isProduction = /^prod/i.test(environmentName.trim());

  return (
    <div className="ig-scope-bar" role="group" aria-label="Workspace filter">
      <label className="ig-scope-bar__field">
        <span className="ig-scope-bar__label">Workspace project {projectLabel}</span>
        <select
          className="ig-scope-bar__control"
          title={projectLabel}
          aria-label={`Workspace project ${projectLabel}`}
          value={typeof scope?.projectId === 'string' ? scope.projectId : ''}
          onChange={(event) => {
            const projectId = event.target.value;
            onChange({
              projectId,
              environment: defaultEnvironmentForProject(projects, projectId, environmentName),
            });
          }}
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={String(project.id)} value={String(project.id)}>
              {project.code ? `${project.name} (${project.code})` : project.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`ig-scope-bar__field${isProduction ? ' ig-scope-bar__field--prod' : ''}`} data-env={isProduction ? 'production' : undefined}>
        <span className="ig-scope-bar__label">Workspace environment</span>
        <select
          className="ig-scope-bar__control"
          title={environmentName || 'All environments'}
          aria-label={`Workspace environment ${environmentName || 'All environments'}`}
          value={environmentName}
          onChange={(event) => onChange({ environment: event.target.value })}
        >
          <option value="">All envs</option>
          {environments.map((environment) => (
            <option key={environment} value={environment}>
              {environment}
            </option>
          ))}
        </select>
      </label>
      {isProduction ? (
        <span className="ig-scope-bar__prod" role="status">
          Production
        </span>
      ) : null}
      <span className="ig-scope-bar__kicker">Workspace filter</span>
      {onClear && hasScope ? (
        <button type="button" className="ig-scope-bar__clear" onClick={onClear}>
          Clear
        </button>
      ) : null}
      {selected ? (
        <p className={`ig-scope-bar__facts${showFacts ? ' is-visible' : ''}`}>
          Workspace filter · Team {typeof selected.team === 'string' && selected.team ? selected.team : 'Unknown'} · Cloud {typeof selected.cloud === 'string' && selected.cloud ? selected.cloud : 'Unknown'} · Configured environments {selected.environments?.length ? selected.environments.map((item) => String(item)).join(', ') : 'Unknown'}
        </p>
      ) : null}
    </div>
  );
}
