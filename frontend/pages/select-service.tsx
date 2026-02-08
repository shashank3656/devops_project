import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';
import { clouds, environments } from '../config/clouds';
import { awsServices, awsServiceList, ServiceField } from '../config/awsServices';
import { gcpServices, gcpServiceList } from '../config/gcpServices';

interface TeamOption {
  id: number;
  name: string;
  slug: string;
  default_env?: string;
  default_cloud?: string;
}

const VALID_CLOUDS = ['aws', 'gcp', 'azure'];

export default function SelectService() {
  const router = useRouter();
  const { toast } = useToast();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [team, setTeam] = useState('');
  const [clientName, setClientName] = useState('');
  const [env, setEnv] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [initialComment, setInitialComment] = useState('');
  const [cloud, setCloud] = useState('');
  const [service, setService] = useState('');
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [error, setError] = useState('');
  const [canCreatePR, setCanCreatePR] = useState<boolean | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  // Pre-select cloud, env, service from URL; load template or saved config when present
  useEffect(() => {
    if (!router.isReady) return;
    const qCloud = router.query.cloud;
    const qEnv = router.query.env;
    const qService = router.query.service;
    const cloudParam = typeof qCloud === 'string' ? qCloud.toLowerCase() : '';
    const envParam = typeof qEnv === 'string' ? qEnv.trim() : '';
    const serviceParam = typeof qService === 'string' ? qService.trim() : '';
    if (VALID_CLOUDS.includes(cloudParam)) setCloud((c) => c || cloudParam);
    if (envParam) setEnv((e) => e || envParam);
    if (serviceParam) setService((s) => s || serviceParam);
  }, [router.isReady, router.query.cloud, router.query.env, router.query.service]);

  // Fetch template or saved config and prefill form
  useEffect(() => {
    if (!router.isReady) return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return;
    const templateId = router.query.template_id;
    const savedId = router.query.saved_id;
    const tid = typeof templateId === 'string' ? templateId : undefined;
    const sid = typeof savedId === 'string' ? savedId : undefined;
    if (!tid && !sid) return;

    const applyConfig = (data: { cloud?: string; env?: string; service?: string; config?: string }) => {
      if (data.cloud && VALID_CLOUDS.includes(data.cloud.toLowerCase())) setCloud(data.cloud.toLowerCase());
      if (data.env) setEnv(data.env);
      if (data.service) setService(data.service);
      if (data.config) {
        try {
          const parsed = JSON.parse(data.config) as Record<string, unknown>;
          if (typeof parsed.team === 'string') setTeam(parsed.team);
          if (typeof parsed.client_name === 'string') setClientName(parsed.client_name);
          if (['low', 'medium', 'high', 'critical'].includes(parsed.priority as string)) setPriority(parsed.priority as 'low' | 'medium' | 'high' | 'critical');
          if (typeof parsed.due_date === 'string') setDueDate(parsed.due_date);
          if (typeof parsed.initial_comment === 'string') setInitialComment(parsed.initial_comment);
          const rest: Record<string, any> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (!['team', 'client_name', 'priority', 'due_date', 'initial_comment', 'comment', 'cloud', 'env', 'service'].includes(k)) {
              rest[k] = v;
            }
          }
          if (Object.keys(rest).length > 0) setFormValues((prev) => ({ ...prev, ...rest }));
        } catch (_) {}
      }
    };

    if (tid) {
      fetch(`${apiUrl}/api/templates/${tid}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => data?.template && applyConfig(data.template))
        .catch(() => {});
    } else if (sid) {
      fetch(`${apiUrl}/api/me/saved-configs/${sid}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => data?.saved_config && applyConfig(data.saved_config))
        .catch(() => {});
    }
  }, [router.isReady, router.query.template_id, router.query.saved_id, apiUrl]);

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    const token = localStorage.getItem('token');
    if (token && token !== 'undefined') {
      Promise.all([
        fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
        fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.ok ? res.json() : null),
      ]).then(([meData, teamsData]) => {
        const u = meData?.user;
        setCanCreatePR(!!(u?.verified && (u?.role === 'contributor' || u?.role === 'admin')));
        setTeams(teamsData?.teams || []);
      }).catch(() => setCanCreatePR(false));
    } else {
      setCanCreatePR(false);
    }
  }, [router, apiUrl]);

  // Get available services based on selected cloud
  const getAvailableServices = () => {
    if (cloud === 'aws') return awsServiceList;
    if (cloud === 'gcp') return gcpServiceList;
    if (cloud === 'azure') return []; // Add Azure services later
    return [];
  };

  // Get service configuration
  const getServiceConfig = () => {
    if (cloud === 'aws' && service) {
      return awsServices[service];
    }
    if (cloud === 'gcp' && service) {
      return gcpServices[service];
    }
    return null;
  };

  // Initialize form values when service changes
  useEffect(() => {
    const config = getServiceConfig();
    if (config) {
      const initialValues: Record<string, any> = {};
      config.fields.forEach(field => {
        if (field.defaultValue !== undefined) {
          initialValues[field.name] = field.defaultValue;
        } else {
          initialValues[field.name] = '';
        }
      });
      setFormValues(initialValues);
    }
  }, [service, cloud]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const renderField = (field: ServiceField) => {
    const value = formValues[field.name] ?? '';

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            className="input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            className="input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleFieldChange(field.name, Number(e.target.value))}
            required={field.required}
          />
        );
      
      case 'select':
        return (
          <select
            className="select"
            value={value}
            onChange={(e) => handleFieldChange(field.name, e.target.value)}
            required={field.required}
          >
            <option value="">Select {field.label}</option>
            {field.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      
      case 'boolean':
        return (
          <div className="checkbox-group">
            <input
              type="checkbox"
              className="checkbox"
              checked={value === true}
              onChange={(e) => handleFieldChange(field.name, e.target.checked)}
            />
            <label>{field.label}</label>
          </div>
        );
      
      default:
        return null;
    }
  };

  const submitRequest = async (asDraft: boolean) => {
    if (!team || !env || !cloud || !service) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    const token = localStorage.getItem('token');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token && token !== 'undefined') headers['Authorization'] = `Bearer ${token}`;

    try {
      const payload = {
        team,
        env,
        cloud,
        service,
        client_name: clientName || undefined,
        priority,
        due_date: dueDate || undefined,
        draft: asDraft,
        initial_comment: initialComment.trim() || undefined,
        config: formValues
      };

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

  const serviceConfig = getServiceConfig();
  const availableServices = getAvailableServices();

  return (
    <>
      <Head>
        <title>Select Cloud & Service - Infrastructure Portal</title>
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
              color: 'var(--text-primary)',
              fontWeight: '700'
            }}>
              Select Cloud & Service
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '15px' }}>
              Choose your cloud provider and service, then configure the infrastructure
            </p>

            {canCreatePR === false && (
              <div className="error" style={{ marginBottom: '24px' }}>
                You don&apos;t have permission to create PRs. Verify your email and ensure your account has contributor or admin role in <a href="/profile" style={{ color: 'inherit', textDecoration: 'underline' }}>Profile</a>.
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="form-group">
                  <label className="label">Team *</label>
                  <select
                    className="select"
                    value={team}
                    onChange={(e) => {
                      const slug = e.target.value;
                      setTeam(slug);
                      const selected = teams.find((t) => t.slug === slug);
                      if (selected) {
                        if (selected.default_env) setEnv(selected.default_env);
                        if (selected.default_cloud) setCloud(selected.default_cloud);
                      }
                    }}
                    required
                  >
                    <option value="">{teams.length === 0 ? 'No teams assigned' : 'Select team'}</option>
                    {teams.map((t) => (
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
                    {environments.map(envOption => (
                      <option key={envOption.value} value={envOption.value}>
                        {envOption.label}
                      </option>
                    ))}
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

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="form-group">
                  <label className="label">Cloud Provider *</label>
                  <select
                    className="select"
                    value={cloud}
                    onChange={(e) => {
                      setCloud(e.target.value);
                      setService(''); // Reset service when cloud changes
                    }}
                    required
                  >
                    <option value="">Select Cloud</option>
                    {clouds.map(cloudOption => (
                      <option key={cloudOption.value} value={cloudOption.value}>
                        {cloudOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Service *</label>
                  <select
                    className="select"
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    required
                    disabled={!cloud || availableServices.length === 0}
                  >
                    <option value="">Select Service</option>
                    {availableServices.map(svc => {
                      const config = cloud === 'aws' ? awsServices[svc] : gcpServices[svc];
                      return (
                        <option key={svc} value={svc}>
                          {config?.displayName || svc}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '24px', padding: '12px 16px', background: 'var(--primary-tint, rgba(59, 130, 246, 0.08))', borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--border-color, #e5e7eb)' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const params = new URLSearchParams();
                    if (cloud) params.set('cloud', cloud);
                    if (service) params.set('service', service);
                    if (env) params.set('env', env);
                    fetch(`${apiUrl}/api/cost-estimate?${params}`)
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.link) window.open(d.link, '_blank', 'noopener,noreferrer');
                      })
                      .catch(() => {});
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}
                >
                  💰 Estimate cost (opens cloud pricing calculator)
                </button>
                <span style={{ marginLeft: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {cloud || service ? 'Opens the provider calculator with your selection.' : 'Select cloud and service above for a direct link to the calculator.'}
                </span>
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

              {serviceConfig && (
                <div className="form-section">
                  <h3 className="form-section-title">
                    Service Configuration
                    {cloud && (
                      <span className={`cloud-badge ${cloud}`} style={{ marginLeft: '12px', fontSize: '11px' }}>
                        {cloud.toUpperCase()}
                      </span>
                    )}
                  </h3>
                  {serviceConfig.fields.map(field => (
                    <div key={field.name} className="form-group">
                      {field.type !== 'boolean' && (
                        <label className="label">
                          {field.label} {field.required && <span style={{ color: 'var(--error-color)' }}>*</span>}
                        </label>
                      )}
                      {renderField(field)}
                    </div>
                  ))}
                </div>
              )}

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
                  disabled={loading || !serviceConfig || canCreatePR !== true}
                >
                  {loading ? <span className="loading"></span> : 'Save as draft'}
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1, minWidth: '140px' }}
                  disabled={loading || !serviceConfig || canCreatePR !== true}
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
          </div>
        </div>
      </div>
    </>
  );
}
