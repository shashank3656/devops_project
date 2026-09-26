import { useMemo } from 'react';
import { defaultEnvironmentForProject, type ScopeProject, type WorkspaceScope } from './useWorkspaceScope';

const FALLBACK_ENVIRONMENTS = ['dev', 'uat', 'prod'];

export default function ScopeBar({
  projects,
  scope,
  onChange,
  onClear,
  catalogEnvironments,
}: {
  projects: ScopeProject[];
  scope: WorkspaceScope;
  onChange: (next: Partial<WorkspaceScope>) => void;
  onClear?: () => void;
  /** NF-03: when set for the selected project, overrides project.environments */
  catalogEnvironments?: string[];
}) {
  const selected = useMemo(
    () => projects.find((project) => String(project.id) === String(scope.projectId)) || null,
    [projects, scope.projectId],
  );
  const environments = useMemo(() => {
    const fromCatalog = (catalogEnvironments || []).map((item) => item.trim()).filter(Boolean);
    if (scope.projectId && fromCatalog.length) {
      return Array.from(new Set(fromCatalog));
    }
    const fromProject = selected?.environments?.length ? selected.environments : [];
    const fromAll = projects.flatMap((project) => project.environments || []);
    const unique = Array.from(new Set((fromProject.length ? fromProject : fromAll).map((item) => item.trim()).filter(Boolean)));
    return unique.length ? unique : FALLBACK_ENVIRONMENTS;
  }, [projects, selected, catalogEnvironments, scope.projectId]);
  const hasScope = Boolean(scope.projectId || scope.environment);

  return (
    <div className="ig-scope-bar" role="group" aria-label="Workspace scope">
      <label className="ig-scope-bar__field">
        <span className="ig-scope-bar__label">Project</span>
        <select
          className="ig-scope-bar__control"
          value={scope.projectId}
          onChange={(event) => {
            const projectId = event.target.value;
            onChange({
              projectId,
              environment: defaultEnvironmentForProject(projects, projectId, scope.environment),
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
      <label className="ig-scope-bar__field">
        <span className="ig-scope-bar__label">Environment</span>
        <select
          className="ig-scope-bar__control"
          value={scope.environment}
          onChange={(event) => onChange({ environment: event.target.value })}
        >
          <option value="">All environments</option>
          {environments.map((environment) => (
            <option key={environment} value={environment}>
              {environment}
            </option>
          ))}
        </select>
      </label>
      {onClear && hasScope ? (
        <button type="button" className="ig-scope-bar__clear" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
