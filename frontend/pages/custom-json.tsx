import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function CustomJSON() {
  const router = useRouter();
  const [team, setTeam] = useState('');
  const [env, setEnv] = useState('');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (!isAuthenticated) {
      router.push('/');
    }
  }, [router]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!team || !env) {
      setError('Please fill in Team Name and Environment');
      return;
    }

    if (!validateJSON(json)) {
      setError('Please fix JSON errors before submitting');
      return;
    }

    setLoading(true);
    setError('');
    setPrUrl('');

    // Use environment variable or fallback to localhost for local development
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

    try {
      let jsonPayload;
      try {
        jsonPayload = JSON.parse(json);
      } catch {
        throw new Error('Invalid JSON format');
      }

      // Merge team and env into the JSON payload
      const payload = {
        team,
        env,
        ...jsonPayload
      };

      // Get auth token and user
      const token = localStorage.getItem('token');
      const user = localStorage.getItem('user');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      
      // Add user ID if available
      if (user) {
        try {
          const userData = JSON.parse(user);
          if (userData.id) {
            headers['X-User-ID'] = userData.id.toString();
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      const response = await fetch(`${apiUrl}/create-pr`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Server returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setPrUrl(data.pr_url || '');
      
      alert('PR Created Successfully! Check the PR URL below.');
    } catch (err: any) {
      console.error('Error creating PR:', err);
      const errorMessage = err.message || 'An error occurred while creating the PR';
      // Check if it's a network error
      if (err.message === 'Failed to fetch' || err.name === 'TypeError' || err.message.includes('NetworkError')) {
        setError(`Cannot connect to backend at ${apiUrl}. Make sure the backend is running.`);
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const exampleJSON = {
    cloud: 'gcp',
    service: 'gke',
    config: {
      cluster_name: 'my-gke-cluster',
      region: 'us-central1',
      node_count: 3,
      machine_type: 'e2-medium'
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
                    <option value="dev">Development</option>
                    <option value="stage">Staging</option>
                    <option value="prod">Production</option>
                  </select>
                </div>
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

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '16px' }}
                disabled={loading || !!jsonError}
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
