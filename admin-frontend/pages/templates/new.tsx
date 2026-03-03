import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

const CLOUDS = ['aws', 'azure', 'gcp'];
const ENVS = ['dev', 'staging', 'prod', 'qa'];

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

export default function NewTemplate() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cloud, setCloud] = useState('aws');
  const [env, setEnv] = useState('prod');
  const [service, setService] = useState('');
  const [config, setConfig] = useState('{}');
  const [portalTeams, setPortalTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    Promise.all([
      fetch(`${apiUrl}/api/admin/teams`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${apiUrl}/api/admin/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(async ([teamsRes, projectsRes]) => {
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
      })
      .catch(() => {});
  }, [apiUrl, router]);

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
    setError('');
    if (!name.trim() || !cloud.trim() || !env.trim() || !service.trim()) {
      setError('Name, cloud, env, and service are required.');
      return;
    }
    let configStr = config.trim() || '{}';
    try {
      JSON.parse(configStr);
    } catch {
      setError('Config must be valid JSON.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/templates`, {
        method: 'POST',
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
          team_ids: selectedTeamIds,
          project_ids: selectedProjectIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.template) {
        router.push('/templates?created=1');
        return;
      }
      setError(data.error || 'Failed to create template');
    } catch {
      setError('Failed to create template. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>New template - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/templates" className="back-link">
            ← Back to Templates
          </Link>
          <div className="card" style={{ maxWidth: 720 }}>
            <h2 className="card-title">Create request template</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
              Pre-filled cloud, env, service and config for users to start from (e.g. &quot;AWS prod EKS&quot;, &quot;GCP dev BigQuery&quot;).
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
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
                  placeholder="e.g. AWS prod EKS"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-desc">Description</label>
                <input
                  id="tpl-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description for users"
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
                    placeholder="e.g. EKS, BigQuery"
                  />
                </div>
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
                  placeholder='{"team": "platform", "priority": "medium"}'
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="tpl-scope">Template visibility</label>
                <span className="label-optional" style={{ display: 'block', marginBottom: 10 }}>
                  Assign the template to specific portal teams. Leave everything unchecked to make it visible to all portal teams.
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
                  Optionally restrict this template to specific onboarded projects. Leave everything unchecked to keep it available across all assigned projects.
                </span>
                {projects.length === 0 ? (
                  <div className="empty-state" style={{ padding: 16, textAlign: 'left' }}>
                    No projects exist yet. This template will remain project-agnostic until projects are onboarded.
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
                {loading ? 'Creating…' : 'Create template'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
