import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';

const TEMPLATE_KEY = 'infra-request-template';

export default function CustomJSON() {
  const router = useRouter();
  const { toast } = useToast();
  interface TeamOption {
    id: number;
    name: string;
    slug: string;
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
        if (data.env) setEnv(data.env);
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
        setJsonError('JSON cannot be empty');
        return false;
      }
      JSON.parse(jsonString);
      setJsonError('');
      return true;
    } catch (e: any) {
      setJsonError(`Invalid JSON: ${e.message}`);
      return false;
    }
  };

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const availableTeams = selectedProject
    ? teams.filter((option) => selectedProject.team_access.some((access) => access.team_id === option.id))
    : teams;

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
      setError('Please fill in Project, Team Name and Environment');
      return;
    }

    if (!validateJSON(json)) {
      setError('Please fix JSON errors before submitting');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    try {
      let jsonPayload;
      try {
        jsonPayload = JSON.parse(json);
      } catch {
        throw new Error('Invalid JSON format');
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
        ...jsonPayload
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
          if (d && d.error) errMsg = d.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      setPrUrl(data.pr_url || '');
      toast(data.message || (asDraft ? 'Draft saved.' : 'Ticket created successfully.'), 'success');
      if (asDraft) {
        router.push('/history');
      } else {
        const params = new URLSearchParams({ id: String(data.id || ''), team: team || '' });
        router.push(`/request-success?${params.toString()}`);
      }
    } catch (err: any) {
      console.error('Error creating PR:', err);
      const errorMessage = err.message || 'An error occurred while creating the PR';
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
        <title>Custom JSON - Infrastructure Portal</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
        <div className="container">
          <div style={{ marginBottom: '24px' }}>
            <button 
              onClick={() => router.push('/home')}
              className="btn btn-secondary"
              style={{ marginBottom: '16px' }}
            >
              ← Back to Home
            </button>
          </div>

          <div className="card">
            <h2 style={{ 
              fontSize: '28px', 
              marginBottom: '8px',
              color: '#333'
            }}>
              Custom JSON Configuration
            </h2>
            <p style={{ color: '#666', marginBottom: '32px' }}>
              Provide your infrastructure configuration as a JSON payload
            </p>

            {canCreatePR === false && (
              <div className="error" style={{ marginBottom: '24px' }}>
                You don&apos;t have permission to create PRs. Verify your email and ensure your account has contributor or admin role in <a href="/profile" style={{ color: 'inherit', textDecoration: 'underline' }}>Profile</a>.
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="form-group">
                  <label className="label">Project *</label>
                  <select
                    className="select"
                    value={projectId}
                    onChange={(e) => {
                      const nextProjectId = Number(e.target.value);
                      setProjectId(Number.isNaN(nextProjectId) ? '' : nextProjectId);
                      setTeam('');
                    }}
                    required
                  >
                    <option value="">{projects.length === 0 ? 'No projects assigned' : 'Select project'}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name} ({project.code})</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Team *</label>
                  <select
                    className="select"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    required
                  >
                    <option value="">{availableTeams.length === 0 ? 'No team access for this project' : 'Select team'}</option>
                    {availableTeams.map((t) => (
                      <option key={t.id} value={t.slug}>{t.name}</option>
                    ))}
                  </select>
                  {teams.length === 0 && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Contact your admin to be added to a team.</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Client Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Optional client or project name"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Environment *</label>
                  <select
                    className="select"
                    value={env}
                    onChange={(e) => setEnv(e.target.value)}
                    required
                  >
                    <option value="">Select Environment</option>
                    <option value="dev">Development</option>
                    <option value="stage">Staging</option>
                    <option value="prod">Production</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Priority</label>
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
                  <input
                    type="date"
                    className="input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="label">Comment / notes (optional)</label>
                <textarea
                  className="textarea"
                  placeholder="Add a note or context for this request (visible to admins)"
                  value={initialComment}
                  onChange={(e) => setInitialComment(e.target.value)}
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className="label">JSON Configuration *</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
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
                      Load Example
                    </button>
                  </div>
                </div>
                <textarea
                  className="textarea"
                  placeholder='{"cloud": "gcp", "service": "gke", "config": {...}}'
                  value={json}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  required
                />
                {jsonError && (
                  <div className="error">{jsonError}</div>
                )}
                {!jsonError && json && (
                  <div className="success">Valid JSON</div>
                )}
              </div>

              {error && (
                <div className="error" style={{ marginBottom: '16px' }}>
                  {error}
                </div>
              )}

              {prUrl && (
                <div className="success" style={{ marginBottom: '16px', flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                  <strong>PR Created Successfully!</strong>
                  <a 
                    href={prUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="link"
                    style={{ fontWeight: '600', fontSize: '15px' }}
                  >
                    View Pull Request →
                  </a>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => submitRequest(true)}
                  className="btn btn-secondary"
                  style={{ flex: 1, minWidth: '140px' }}
                  disabled={loading || !!jsonError || canCreatePR !== true}
                >
                  {loading ? <span className="loading"></span> : 'Save as draft'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, minWidth: '140px' }}
                  disabled={loading || !!jsonError || canCreatePR !== true}
                >
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="loading"></span>
                      Submitting...
                    </span>
                  ) : (
                    'Submit for approval'
                  )}
                </button>
              </div>
            </form>

            <div className="form-section" style={{ 
              marginTop: '32px', 
              fontSize: '14px'
            }}>
              <strong>JSON Structure:</strong>
              <pre style={{ 
                marginTop: '12px', 
                padding: '12px', 
                background: 'white', 
                borderRadius: '4px',
                overflow: 'auto',
                fontSize: '12px'
              }}>
{JSON.stringify(exampleJSON, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
