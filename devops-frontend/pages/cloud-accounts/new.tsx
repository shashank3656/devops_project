import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { PageHeader, portalFetch } from '@infragate/ui';

interface DevopsTeam {
  id: number;
  name: string;
  slug: string;
}

const ENV_PRESETS = ['dev', 'uat', 'stage', 'prod'];

export default function CloudAccountOnboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<DevopsTeam[]>([]);
  const [provider, setProvider] = useState('aws');
  const [accountId, setAccountId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [envInput, setEnvInput] = useState('dev, prod');
  const [authMode, setAuthMode] = useState('assume_role');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    portalFetch(`${apiUrl}/api/devops/my-teams`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.teams)) {
          setTeams(data.teams);
          if (data.teams[0]?.slug) setTeamSlug(data.teams[0].slug);
        }
      })
      .catch(() => {});
  }, [apiUrl, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('devops_token');
    if (!token) return;
    setSaving(true);
    setError('');
    const environments = envInput
      .split(/[,\\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    try {
      const res = await portalFetch(`${apiUrl}/api/devops/cloud/accounts`, {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          account_id: accountId.trim(),
          display_name: displayName.trim(),
          team_slug: teamSlug.trim(),
          environments,
          auth_mode: authMode,
          role_arn: roleArn.trim(),
          external_id: externalId.trim(),
          secret_ref: secretRef.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to onboard account');
      const id = data?.account?.id;
      if (id) void router.push(`/cloud-accounts/${id}`);
      else void router.push('/cloud-accounts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to onboard');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Onboard cloud account - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Onboard cloud account"
          subtitle="Register the account and role trust here. Access keys are never sent to the browser — use IAM role assumption or a server-side secret reference."
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form className="portal-surface portal-form-grid" onSubmit={(e) => void submit(e)}>
          <label className="label">
            Provider
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="aws">AWS</option>
              <option value="azure" disabled>
                Azure (catalog only)
              </option>
              <option value="gcp" disabled>
                GCP (catalog only)
              </option>
            </select>
          </label>
          <label className="label">
            AWS account ID
            <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required pattern="[0-9]{12}" placeholder="111122223333" />
          </label>
          <label className="label">
            Display name
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder="Platform production" />
          </label>
          <label className="label">
            DevOps team
            <select className="input" value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)} required>
              <option value="">Select team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name} ({t.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Environments
            <input className="input" value={envInput} onChange={(e) => setEnvInput(e.target.value)} placeholder={ENV_PRESETS.join(', ')} />
          </label>
          <label className="label">
            Auth mode
            <select className="input" value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
              <option value="assume_role">Assume IAM role (recommended)</option>
              <option value="static_ref">Server secret reference (last resort)</option>
            </select>
          </label>
          {authMode === 'assume_role' ? (
            <>
              <label className="label">
                Role ARN
                <input className="input" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required placeholder="arn:aws:iam::111122223333:role/SetuOpsInventory" />
              </label>
              <label className="label">
                External ID
                <input className="input" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="Trust external ID (recommended)" />
              </label>
            </>
          ) : (
            <label className="label">
              Secret reference (env var name on API host)
              <input className="input" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} required placeholder="CLOUD_ACCOUNT_PLATFORM_KEYS" />
            </label>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save and test next'}
            </button>
            <Link href="/cloud-accounts" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </DevOpsLayout>
  );
}
