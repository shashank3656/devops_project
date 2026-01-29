import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';
import { clouds, environments } from '../config/clouds';
import { awsServices, awsServiceList, ServiceField } from '../config/awsServices';
import { gcpServices, gcpServiceList } from '../config/gcpServices';

export default function SelectService() {
  const router = useRouter();
  const { toast } = useToast();
  const [team, setTeam] = useState('');
  const [env, setEnv] = useState('');
  const [cloud, setCloud] = useState('');
  const [service, setService] = useState('');
  const [formValues, setFormValues] = useState<Record<string, any>>({});
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
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`${apiUrl}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          const u = data?.user;
          setCanCreatePR(!!(u?.verified && (u?.role === 'contributor' || u?.role === 'admin')));
        })
        .catch(() => setCanCreatePR(false));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!team || !env || !cloud || !service) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    // Use environment variable or fallback to localhost for local development
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    const token = localStorage.getItem('token');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const payload = {
        team,
        env,
        cloud,
        service,
        config: formValues
      };

      const response = await fetch(`${apiUrl}/create-pr`, {
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
      toast('PR created successfully. Check the PR URL below.', 'success');
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
                  <label className="label">Team Name *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Enter team name"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    required
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

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '16px' }}
                disabled={loading || !serviceConfig || canCreatePR !== true}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span className="loading"></span>
                    Creating PR...
                  </span>
                ) : (
                  'Create Pull Request'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
