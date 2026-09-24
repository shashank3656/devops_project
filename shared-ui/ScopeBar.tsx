import { useMemo } from 'react';
import { type ScopeProject, type WorkspaceScope } from './useWorkspaceScope';

const FALLBACK_ENVIRONMENTS = ['dev', 'uat', 'prod'];

export default function ScopeBar({
  projects,
  scope,
  onChange,
}: {
  projects: ScopeProject[];
  scope: WorkspaceScope;
  onChange: (next: Partial<WorkspaceScope>) => void;
}) {
  const selected = useMemo(
    () => projects.find((project) => String(project.id) === String(scope.projectId)) || null,
    [projects, scope.projectId],
  );
  const environments = useMemo(() => {
    const fromProject = selected?.environments?.length ? selected.environments : [];
    const fromAll = projects.flatMap((project) => project.environments || []);
    const unique = Array.from(new Set((fromProject.length ? fromProject : fromAll).map((item) => item.trim()).filter(Boolean)));
    return unique.length ? unique : FALLBACK_ENVIRONMENTS;
  }, [projects, selected]);

  return (
    <div className="ig-scope-bar" role="group" aria-label="Workspace scope">
      <label className="ig-scope-bar__field">
        <span className="ig-scope-bar__label">Project</span>
        <select
          className="ig-scope-bar__control"
          value={scope.projectId}
          onChange={(event) => {
            const projectId = event.target.value;
            const project = projects.find((item) => String(item.id) === projectId);
            const nextEnv =
              project?.environments?.includes(scope.environment) ? scope.environment : project?.environments?.[0] || '';
            onChange({ projectId, environment: nextEnv });
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
    </div>
  );
}
