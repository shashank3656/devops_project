import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState, type FormEvent } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function PolicyConfigurePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [name, setName] = useState('No public prod');
  const [target, setTarget] = useState('change');
  const [rego, setRego] = useState(`deny[msg] {
  input.environment == "prod"
  input.public == "true"
  msg := "public resources are not allowed in prod"
}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/devops/policies`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, target, rego, enabled: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      router.push('/policies');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Configure policy - SetuOps</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Policy as code</span>
            <h1 className="portal-page__title">Configure</h1>
            <p className="portal-page__subtitle">Use deny blocks with input.field == &quot;value&quot;. This is not a full OPA runtime.</p>
          </div>
          <Link href="/policies" className="btn btn-secondary">Back</Link>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form className="portal-surface" onSubmit={save}>
          <label className="label">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="label">
            Target
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="change">Change request</option>
              <option value="request">request.json / ticket</option>
            </select>
          </label>
          <label className="label">
            Rego
            <textarea className="input" rows={10} value={rego} onChange={(e) => setRego(e.target.value)} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
      </div>
    </DevOpsLayout>
  );
}
