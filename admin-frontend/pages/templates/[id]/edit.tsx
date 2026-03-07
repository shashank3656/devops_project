import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../../components/AdminLayout';

const CLOUDS = ['aws', 'azure', 'gcp'];
const ENVS = ['dev', 'staging', 'prod', 'qa'];

interface RequestTemplate {
  id: number;
  name: string;
  description: string;
  cloud: string;
  env: string;
  service: string;
  config: string;
  status?: TemplateStatus;
  teams?: TeamSummary[];
  projects?: ProjectSummary[];
  visible_to_all?: boolean;
}

type TemplateStatus = 'draft' | 'pending_approval' | 'published' | 'archived';

interface TeamSummary {
  id: number;
  name: string;
  team_type?: string;
}

interface ProjectSummary {
  id: number;
  name: string;
  code: string;
  status?: string;
}

export default function EditTemplate() {
  const router = useRouter();
  const { id } = router.query;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloud, setCloud] = useState('aws');
  const [env, setEnv] = useState('prod');
  const [service, setService] = useState('');
  const [config, setConfig] = useState('{}');
  const [status, setStatus] = useState<TemplateStatus>('draft');
  const [portalTeams, setPortalTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const fetchTeams = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) return;
    try {
      const [teamsRes, projectsRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/teams`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/api/admin/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if ([teamsRes.status, projectsRes.status].some((status) => status === 401 || status === 403)) {
        router.replace('/login');
        return;
      }
      const teamsData = await teamsRes.json().catch(() => ({}));
      const projectsData = await projectsRes.json().catch(() => ({}));
      if (teamsRes.ok && Array.isArray(teamsData.teams)) {
        setPortalTeams(
          teamsData.teams.filter((team: TeamSummary) => (team.team_type || 'portal') === 'portal'),
        );
      }
      if (projectsRes.ok && Array.isArray(projectsData.projects)) {
        setProjects(projectsData.projects);
      }
    } catch {
      // Leave the form usable even if the team list fails to load.
    }
  }, [apiUrl, router]);

  const fetchTemplate = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token || typeof id !== 'string' || !id) return;
    setFetchLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template) {
        const t = data.template as RequestTemplate;
        setName(t.name);
        setDescription(t.description || '');
        setCloud(t.cloud || 'aws');
        setEnv(t.env || 'prod');
        setService(t.service || '');
        setConfig(t.config || '{}');
        setStatus((t.status as TemplateStatus) || 'draft');
        setSelectedTeamIds(Array.isArray(t.teams) ? t.teams.map((team) => team.id) : []);
        setSelectedProjectIds(Array.isArray(t.projects) ? t.projects.map((project) => project.id) : []);
        setError('');
      } else {
        setError(data.error || 'Template not found');
      }
    } catch {
      setError('Failed to load template. Check your connection.');
    } finally {
      setFetchLoading(false);
    }
  }, [id, router, apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    void fetchTeams();
    if (typeof id === 'string' && id) fetchTemplate();
  }, [id, router, fetchTemplate, fetchTeams]);

  const toggleTeam = (teamID: number) => {
    setSelectedTeamIds((current) =>
      current.includes(teamID) ? current.filter((id) => id !== teamID) : [...current, teamID],
    );
  };

  const toggleProject = (projectID: number) => {
    setSelectedProjectIds((current) =>
      current.includes(projectID) ? current.filter((id) => id !== projectID) : [...current, projectID],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string') return;
    setError('');
    if (!name.trim() || !cloud.trim() || !env.trim() || !service.trim()) {
      setError('Name, cloud, env, and service are required.');
      return;
    }
    const configStr = config.trim() || '{}';
    try {
      JSON.parse(configStr);
    } catch {
      setError('Config must be valid JSON.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          cloud: cloud.trim(),
          env: env.trim(),
          service: service.trim(),
          config: configStr,
          status,
          team_ids: selectedTeamIds,
          project_ids: selectedProjectIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/templates?updated=1');
        return;
      }
      setError(data.error || 'Failed to update template');
    } catch {
      setError('Failed to update template. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <AdminLayout>
        <div className="container">
          <p>Loading template…</p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Edit template - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/templates" className="back-link">
            ← Back to Templates
          </Link>
          <div className="card" style={{ maxWidth: 720 }}>
            <h2 className="card-title">Edit template</h2>
            {error && (
              <div className="alert alert-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <span>{error}</span>
                <button type="button" className="btn btn-secondary" style={{ padding: '8px 16px' }} onClick={fetchTemplate}>
                  Retry
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="tpl-name">Name <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                <input
                  id="tpl-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-desc">Description</label>
                <input
                  id="tpl-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-cloud">Cloud *</label>
                  <select id="tpl-cloud" className="input" value={cloud} onChange={(e) => setCloud(e.target.value)}>
                    {CLOUDS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-env">Environment *</label>
                  <select id="tpl-env" className="input" value={env} onChange={(e) => setEnv(e.target.value)}>
                    {ENVS.map((envOpt) => (
                      <option key={envOpt} value={envOpt}>{envOpt}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="tpl-service">Service *</label>
                  <input
                    id="tpl-service"
                    className="input"
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-status">Governance status</label>
                <select id="tpl-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as TemplateStatus)}>
                  <option value="draft">Draft</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
                <span className="label-optional" style={{ display: 'block', marginTop: 8 }}>
                  Only published templates are visible to end users. Use pending approval when the template is ready for review but should not be launched yet.
                </span>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-config">Config (JSON)</label>
                <textarea
                  id="tpl-config"
                  className="input"
                  value={config}
                  onChange={(e) => setConfig(e.target.value)}
                  rows={6}
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-scope">Template visibility</label>
                <span className="label-optional" style={{ display: 'block', marginBottom: 10 }}>
                  Assign the template to specific portal teams. Leave everything unchecked to keep it visible to all portal teams.
                </span>
                {portalTeams.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16, textAlign: 'left' }}>
                    No portal teams exist yet. <Link href="/teams/new">Create a team first</Link>.
                  </div>
                ) : (
                  <div id="tpl-scope" className="admin-team-check-row">
                    {portalTeams.map((team) => (
                      <label key={team.id} className="admin-team-check">
                        <input
                          type="checkbox"
                          checked={selectedTeamIds.includes(team.id)}
                          onChange={() => toggleTeam(team.id)}
                        />
                        <span>{team.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="label-optional" style={{ display: 'block', marginTop: 8 }}>
                  {selectedTeamIds.length === 0
                    ? 'Visible to all portal teams.'
                    : `Assigned to ${selectedTeamIds.length} portal team${selectedTeamIds.length === 1 ? '' : 's'}.`}
                </span>
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-project-scope">Project scope</label>
                <span className="label-optional" style={{ display: 'block', marginBottom: 10 }}>
                  Restrict this template to specific onboarded projects. Leave unchecked to keep it available across all assigned projects.
                </span>
                {projects.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16, textAlign: 'left' }}>
                    No projects exist yet. This template remains project-agnostic.
                  </div>
                ) : (
                  <div id="tpl-project-scope" className="admin-team-check-row">
                    {projects.map((project) => (
                      <label key={project.id} className="admin-team-check">
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.includes(project.id)}
                          onChange={() => toggleProject(project.id)}
                        />
                        <span>{project.name} ({project.code})</span>
                      </label>
                    ))}
                  </div>
                )}
                <span className="label-optional" style={{ display: 'block', marginTop: 8 }}>
                  {selectedProjectIds.length === 0
                    ? 'Visible across all assigned projects.'
                    : `Restricted to ${selectedProjectIds.length} project${selectedProjectIds.length === 1 ? '' : 's'}.`}
                </span>
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '10px 24px' }}>
                {loading ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
