import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CLOUD_PROVIDER_SEGMENT,
  normalizeCloudProvider,
  providerFormCopy,
  type CloudProviderId,
} from '../../lib/cloudProviders';
import CloudTrustSetupGuide from '../../components/CloudTrustSetupGuide';
import { PageHeader, SegmentedControl, portalFetch } from '@infragate/ui';

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
  const [provider, setProvider] = useState<CloudProviderId>('aws');
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

  const copy = useMemo(() => providerFormCopy(provider), [provider]);

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

  const onProviderChange = (next: string) => {
    const id = normalizeCloudProvider(next);
    setProvider(id);
    setAccountId('');
    setRoleArn('');
    setExternalId('');
    setSecretRef('');
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('devops_token');
    if (!token) return;
    setSaving(true);
    setError('');
    const environments = envInput
      .split(/[,\s]+/)
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

  const accountInputProps =
    provider === 'aws'
      ? { pattern: '[0-9]{12}', title: '12-digit AWS account ID' }
      : provider === 'azure'
        ? {
            pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
            title: 'Azure subscription GUID',
          }
        : { pattern: '[a-z][a-z0-9-]{4,28}[a-z0-9]', title: 'GCP project ID' };

  return (
    <DevOpsLayout>
      <Head>
        <title>Onboard cloud account - DevOps</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Onboard cloud account"
          subtitle={copy.onboardBlurb}
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <CloudTrustSetupGuide provider={provider} />
        <form className="portal-surface portal-form-grid" onSubmit={(e) => void submit(e)}>
          <div className="label" style={{ gridColumn: '1 / -1' }}>
            <span>Cloud provider</span>
            <SegmentedControl
              label="Cloud provider"
              name="cloud-provider"
              options={CLOUD_PROVIDER_SEGMENT}
              value={provider}
              onChange={onProviderChange}
            />
          </div>
          <label className="label">
            {copy.accountIdLabel}
            <input
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
              placeholder={copy.accountIdPlaceholder}
              {...accountInputProps}
            />
            <span className="ig-muted" style={{ fontSize: 12 }}>
              {copy.accountIdHint}
            </span>
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
              <option value="assume_role">{copy.assumeAuthLabel}</option>
              <option value="static_ref">{copy.staticAuthLabel}</option>
            </select>
          </label>
          {authMode === 'assume_role' ? (
            <>
              <label className="label">
                {copy.roleLabel}
                <input className="input" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required placeholder={copy.rolePlaceholder} />
              </label>
              <label className="label">
                {copy.externalIdLabel}
                <input className="input" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder={copy.externalIdPlaceholder} />
              </label>
            </>
          ) : (
            <label className="label">
              Secret reference (env var name on API host)
              <input className="input" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} required placeholder="CLOUD_ACCOUNT_PLATFORM_KEYS" />
            </label>
          )}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save and test on server'}
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
