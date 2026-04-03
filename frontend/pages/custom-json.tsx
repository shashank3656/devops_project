import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { useToast } from '../context/ToastContext';
import CalendarDateInput from '../components/CalendarDateInput';
import { environments } from '../config/clouds';

const TEMPLATE_KEY = 'infra-request-template';
const ENV_LABEL_OVERRIDES: Record<string, string> = {
  dev: 'Development',
  development: 'Development',
  qa: 'QA',
  uat: 'UAT',
  stage: 'Staging',
  staging: 'Staging',
  prod: 'Production',
  production: 'Production',
};

function normalizeEnvironmentValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function formatEnvironmentLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const configured = environments.find((item) => item.value === normalized);
  if (configured) return configured.label;
  if (ENV_LABEL_OVERRIDES[normalized]) return ENV_LABEL_OVERRIDES[normalized];
  return normalized
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export default function CustomJSON() {
  const router = useRouter();
  const { toast } = useToast();
  interface TeamOption {
    id: number;
    name: string;
    slug: string;
    default_env?: string;
  }
  interface ProjectTeamAccess {
    team_id: number;
    team_name: string;
    team_slug: string;
    environments: string[];
  }
  interface ProjectOption {
    id: number;
    name: string;
    code: string;
    environments: string[];
    team_access: ProjectTeamAccess[];
  }
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState<number | ''>('');
  const [team, setTeam] = useState('');
  const [clientName, setClientName] = useState('');
  const [env, setEnv] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [initialComment, setInitialComment] = useState('');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [error, setError] = useState('');
  const [canCreatePR, setCanCreatePR] = useState<boolean | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    const template = sessionStorage.getItem(TEMPLATE_KEY);
    if (template) {
      try {
        const data = JSON.parse(template);
        if (data.project_id) setProjectId(Number(data.project_id));
        if (data.team) setTeam(data.team);
        if (data.env) setEnv(String(data.env).trim().toLowerCase());
        if (data.client_name) setClientName(data.client_name);
        if (data.config && typeof data.config === 'string') setJson(data.config);
        else if (data.config && typeof data.config === 'object') setJson(JSON.stringify(data.config, null, 2));
        sessionStorage.removeItem(TEMPLATE_KEY);
      } catch (_) {
        sessionStorage.removeItem(TEMPLATE_KEY);
      }
    }
    const token = localStorage.getItem('token');
    if (token && token !== 'undefined') {
      Promise.all([
        fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
        fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
        fetch(`${apiUrl}/api/me/projects`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
      ]).then(([meData, teamsData, projectsData]) => {
        const u = meData?.user;
        setCanCreatePR(!!(u?.verified && (u?.role === 'contributor' || u?.role === 'admin')));
        setTeams(teamsData?.teams || []);
        setProjects(Array.isArray(projectsData?.projects) ? projectsData.projects : []);
      }).catch(() => setCanCreatePR(false));
    } else {
      setCanCreatePR(false);
    }
  }, [router, apiUrl]);

  const validateJSON = (jsonString: string): boolean => {
    try {
      if (!jsonString.trim()) {
        setJsonError('Add a JSON request body first.');
        return false;
      }
      JSON.parse(jsonString);
      setJsonError('');
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setJsonError(`JSON format issue: ${message}`);
      return false;
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const availableTeams = selectedProject
    ? teams.filter((option) => selectedProject.team_access.some((access) => access.team_id === option.id))
    : teams;
  const availableEnvironments = (() => {
    if (!selectedProject) return normalizeEnvironmentValues(environments.map((item) => item.value));
    const access = selectedProject.team_access.find((entry) => entry.team_slug === team);
    const sourceValues = access?.environments?.length ? access.environments : selectedProject.environments;
    return normalizeEnvironmentValues(sourceValues);
  })();
  const availableEnvironmentOptions = availableEnvironments.map((value) => ({
    value,
    label: formatEnvironmentLabel(value),
  }));

  useEffect(() => {
    if (!selectedProject) return;
    const teamAllowed = availableTeams.some((entry) => entry.slug === team);
    if (team && !teamAllowed) setTeam('');
    if (env && !availableEnvironments.includes(env.trim().toLowerCase())) setEnv('');
  }, [selectedProject, availableTeams, availableEnvironments, team, env]);

  const handleJsonChange = (value: string) => {
    setJson(value);
    if (value.trim()) {
      validateJSON(value);
    } else {
      setJsonError('');
    }
  };

  const formatJSON = () => {
    if (!json.trim()) return;
    
    try {
      const parsed = JSON.parse(json);
      setJson(JSON.stringify(parsed, null, 2));
      setJsonError('');
    } catch (e: any) {
      setJsonError(`Invalid JSON: ${e.message}`);
    }
  };

  const submitRequest = async (asDraft: boolean) => {
    if (!projectId || !team || !env) {
      setError('Choose a project, team, and environment first.');
      return;
    }

    if (!validateJSON(json)) {
      setError('Fix the JSON issues before sending the request.');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    try {
      let jsonPayload: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(json);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('The JSON body must be an object.');
        }
        jsonPayload = parsed as Record<string, unknown>;
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message === 'The JSON body must be an object.') {
          throw parseErr;
        }
        throw new Error('The JSON format is not valid.');
      }

      const payloadCloud = getStringValue(jsonPayload.cloud).toLowerCase();
      const payloadService = getStringValue(jsonPayload.service);
      if (!payloadCloud || !payloadService) {
        throw new Error('The JSON must include both "cloud" and "service".');
      }

      const payload = {
        project_id: projectId,
        team,
        env,
        client_name: clientName || undefined,
        priority,
        due_date: dueDate || undefined,
        draft: asDraft,
        initial_comment: initialComment.trim() || undefined,
        ...jsonPayload,
        cloud: payloadCloud,
        service: payloadService
      };

      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${apiUrl}/api/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = text || `Server returned ${response.status}`;
        try {
          const d = JSON.parse(text);
          if (d?.error) errMsg = d.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      setPrUrl(data.pr_url || '');
      toast(data.message || (asDraft ? 'Draft saved.' : 'Request sent successfully.'), 'success');
      if (asDraft) {
        router.push('/history');
      } else {
        const params = new URLSearchParams({ id: String(data.id || ''), team: team || '' });
        router.push(`/request-success?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('Error creating PR:', err);
      const errorMessage = err.message || 'Something went wrong while sending the request.';
      if (err.message === 'Failed to fetch' || err.name === 'TypeError' || err.message.includes('NetworkError')) {
        setError(`Cannot connect to backend at ${apiUrl}. Make sure the backend is running.`);
        toast('Cannot connect to backend', 'error');
      } else {
        setError(errorMessage);
        toast(errorMessage, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitRequest(false);
  };

  const canSubmitRequest = loading || !!jsonError || !projectId || !team || !env || canCreatePR !== true;
  const requestReady = !!(projectId && team && env && !jsonError && json.trim());

  const exampleJSON = {
    cloud: 'gcp',
    service: 'gke',
    config: {
      gke_clusters: {
        az2: {
          regional: true,
          region: 'asia-east2',
          zones: ['b'],
          maintenance_start_time: '18:00',
          cluster_autoscaling: {
            enabled: false,
            autoscaling_profile: 'OPTIMIZE_UTILIZATION',
            max_cpu_cores: 32,
            min_cpu_cores: 0,
            max_memory_gb: 130,
            min_memory_gb: 0
          },
          node_pools: {
            np1: {
              machine_type: 'e2-standard-4',
              disk_type: 'pd-standard',
              disk_size_gb: 50,
              autoscaling: true,
              min_count: 3,
              max_count: 3,
              auto_upgrade: true
            }
          }
        }
      }
    }
  };

  return (
    <>
      <Head>
        <title>Advanced JSON Request - SetuOps</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div className="request-builder">
            <div className="request-builder__header">
              <button
                onClick={() => router.push('/home')}
                className="btn btn-secondary request-builder__back"
              >
                ← Back to Home
              </button>
              <h1 className="request-builder__title">Advanced JSON request</h1>
              <p className="request-builder__subtitle">
                Use this path only when you already know the full request body. The JSON must include at least <code>cloud</code> and <code>service</code>.
              </p>
            </div>

            {canCreatePR === false && (
              <div className="error">
                Your account cannot send requests yet. Verify your email and check your role in <Link href="/profile" style={{ color: 'inherit', textDecoration: 'underline' }}>Profile</Link>.
              </div>
            )}

            {error && (
              <div className="error">
                {error}
              </div>
            )}

            {prUrl && (
              <div className="success" style={{ marginBottom: 0, flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                <strong>Request sent successfully</strong>
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link"
                  style={{ fontWeight: '600', fontSize: '15px' }}
                >
                  Open Pull Request →
                </a>
              </div>
            )}

            <div className="request-builder__layout">
              <form onSubmit={handleSubmit} className="request-builder__main">
                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Step 1: Choose the basics</h2>
                    <p>Set the project, team, and environment so the request routes to the right reviewers.</p>
                  </div>
                  <div className="request-builder__grid">
                <div className="form-group">
                  <label className="label">Project *</label>
                  <select
                    className="select"
                    value={projectId}
                    onChange={(e) => {
                      const nextProjectId = Number(e.target.value);
                      setProjectId(Number.isNaN(nextProjectId) ? '' : nextProjectId);
                      setTeam('');
                      setEnv('');
                    }}
                    required
                  >
                    <option value="">{projects.length === 0 ? 'No projects assigned' : 'Select project'}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                    ))}
                  </select>
                  {selectedProject && (
                    <p className="request-builder__note">{selectedProject.name} controls which teams and environments are allowed.</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Team *</label>
                  <select
                    className="select"
                    value={team}
                    onChange={(e) => {
                      const slug = e.target.value;
                      setTeam(slug);
                      const selected = availableTeams.find((entry) => entry.slug === slug);
                      const defaultEnv = selected?.default_env?.trim().toLowerCase();
                      if (defaultEnv && availableEnvironments.includes(defaultEnv)) {
                        setEnv(defaultEnv);
                      }
                    }}
                    required
                  >
                    <option value="">{availableTeams.length === 0 ? 'No team access for this project' : 'Select team'}</option>
                    {availableTeams.map((t) => (
                      <option key={t.id} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                  {teams.length === 0 && (
                    <p className="request-builder__note">Ask your admin to add you to a team first.</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Business name or client</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional business, client, or internal project name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Environment *</label>
                  <select
                    className="select"
                    value={env}
                    onChange={(e) => setEnv(e.target.value.trim().toLowerCase())}
                    required
                  >
                    <option value="">Choose environment</option>
                    {availableEnvironmentOptions.map((envOption) => (
                      <option key={envOption.value} value={envOption.value}>
                        {envOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Urgency</label>
                  <select
                    className="select"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Due date</label>
                  <CalendarDateInput value={dueDate} onChange={setDueDate} />
                </div>
                  </div>
                </section>

                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Step 2: Paste the JSON body</h2>
                    <p>Paste or load the request body below, then format it before you send.</p>
                  </div>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: 12, flexWrap: 'wrap' }}>
                      <label className="label">JSON request body *</label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={formatJSON}
                      className="btn btn-secondary"
                      style={{ padding: '8px 16px', fontSize: '14px' }}
                    >
                      Format JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => setJson(JSON.stringify(exampleJSON, null, 2))}
                      className="btn btn-secondary"
                      style={{ padding: '8px 16px', fontSize: '14px' }}
                    >
                      Load example
                    </button>
                      </div>
                    </div>
                    <textarea
                      className="textarea"
                      placeholder='{"cloud":"gcp","service":"gke","config":{...}}'
                      value={json}
                      onChange={(e) => handleJsonChange(e.target.value)}
                      required
                      rows={16}
                    />
                    {jsonError && (
                      <div className="error">{jsonError}</div>
                    )}
                    {!jsonError && json && (
                      <div className="success">JSON looks valid</div>
                    )}
                  </div>
                </section>

                <section className="request-builder__section">
                  <div className="request-builder__section-header">
                    <h2>Step 3: Add context and send</h2>
                    <p>Add a note only if reviewers need extra business context.</p>
                  </div>
                  <div className="form-group">
                    <label className="label">Comment / notes (optional)</label>
                    <textarea
                      className="textarea"
                      placeholder="Add any useful background for reviewers"
                      value={initialComment}
                      onChange={(e) => setInitialComment(e.target.value)}
                      rows={3}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  <div className="request-builder__actions">
                <button
                  type="button"
                  onClick={() => submitRequest(true)}
                  className="btn btn-secondary"
                  disabled={canSubmitRequest}
                >
                  {loading ? <span className="loading"></span> : 'Save draft'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={canSubmitRequest}
                >
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="loading"></span>
                      Sending...
                    </span>
                  ) : (
                    'Send for review'
                  )}
                </button>
                  </div>
                </section>
              </form>

              <aside className="request-builder__side">
                <div className="request-builder__summary">
                  <h3>Request summary</h3>
                  <p>This is the context currently attached to the JSON request.</p>
                  <div className="request-builder__summary-list">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Project</span>
                      <span className="request-builder__summary-value">{selectedProject ? `${selectedProject.name} (${selectedProject.code})` : 'Not chosen yet'}</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Team</span>
                      <span className="request-builder__summary-value">{team || 'Not chosen yet'}</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">Environment</span>
                      <span className="request-builder__summary-value">{env || 'Not chosen yet'}</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-label">JSON status</span>
                      <span className="request-builder__summary-value">{jsonError ? 'Needs fixes' : json.trim() ? 'Ready to review' : 'Waiting for JSON body'}</span>
                    </div>
                  </div>
                </div>

                <div className="request-builder__summary">
                  <h3>What the JSON must include</h3>
                  <div className="request-builder__summary-list request-builder__summary-list--plain">
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value"><code>cloud</code> and <code>service</code> are required.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">The body must be a JSON object, not a list.</span>
                    </div>
                    <div className="request-builder__summary-item">
                      <span className="request-builder__summary-value">{requestReady ? 'This request is ready to save or send.' : 'Finish the required fields and fix any JSON issues first.'}</span>
                    </div>
                  </div>
                </div>

                <div className="request-builder__summary request-builder__example">
                  <h3>Example request body</h3>
                  <pre>
{JSON.stringify(exampleJSON, null, 2)}
                  </pre>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
