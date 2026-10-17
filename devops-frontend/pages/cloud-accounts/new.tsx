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
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';

interface DevopsTeam {
  id: number;
  name: string;
  slug: string;
}

interface ProjectOption {
  id: number;
  name: string;
  code?: string;
}

export default function CloudAccountOnboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [teams, setTeams] = useState<DevopsTeam[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [envOptions, setEnvOptions] = useState<string[]>([]);
  const [environments, setEnvironments] = useState<string[]>([]);
  const [envsLoading, setEnvsLoading] = useState(false);
  const [provider, setProvider] = useState<CloudProviderId>('aws');
  const [accountId, setAccountId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [authMode, setAuthMode] = useState('assume_role');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { allowLeave } = useUnsavedChanges(Boolean(accountId.trim() || displayName.trim() || projectId || roleArn.trim() || externalId.trim() || secretRef.trim() || environments.length));

  const copy = useMemo(() => providerFormCopy(provider), [provider]);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    portalFetch(`${apiUrl}/api/devops/projects`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.projects)) setProjects(data.projects);
      })
      .catch(() => {});
  }, [apiUrl, router]);

  useEffect(() => {
    if (!projectId) {
      setEnvOptions([]);
      setEnvironments([]);
      setTeams([]);
      setTeamSlug('');
      return;
    }
    const token = localStorage.getItem('devops_token');
    if (!token) return;
    setEnvsLoading(true);
    setEnvironments([]);
    setTeams([]);
    setTeamSlug('');
    portalFetch(`${apiUrl}/api/devops/projects/${projectId}`, { token })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        const raw = data?.project?.environments;
        const next = Array.isArray(raw) ? raw.filter((item: unknown) => typeof item === 'string' && item.trim()) : [];
        setEnvOptions(next);
        if (next.length === 1) setEnvironments(next);
        const access = Array.isArray(data?.project?.team_access) ? data.project.team_access : [];
        const nextTeams = access
          .map((item: { team_id?: number; team_name?: string; team_slug?: string }) => ({
            id: Number(item.team_id) || 0,
            name: item.team_name || item.team_slug || '',
            slug: item.team_slug || '',
          }))
          .filter((item: DevopsTeam) => item.slug);
        setTeams(nextTeams);
        if (nextTeams.length === 1) setTeamSlug(nextTeams[0].slug);
      })
      .catch(() => {
        setEnvOptions([]);
        setTeams([]);
      })
      .finally(() => setEnvsLoading(false));
  }, [apiUrl, projectId]);

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
    if (environments.length === 0) {
      setError('Choose an environment from this project.');
      return;
    }
    setSaving(true);
    setError('');
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
          project_id: Number(projectId),
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
      allowLeave();
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
        <title>Onboard cloud account - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <PageHeader
          eyebrow="Cloud"
          title="Onboard cloud account"
          subtitle={copy.onboardBlurb}
        />
        {error ? <div className="alert alert-error">{error}</div> : null}
        <CloudTrustSetupGuide provider={provider} />
        <form className="portal-surface" onSubmit={(e) => void submit(e)}>
          <p className="form-req-note"><span aria-hidden="true">*</span> Required</p>
          <fieldset className="form-section">
            <legend className="form-section__title">Account</legend>
            <div className="portal-form-grid">
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
            {copy.accountIdLabel}<span className="form-req" aria-hidden="true"> *</span>
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
            Display name<span className="form-req" aria-hidden="true"> *</span>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required placeholder="Platform production" />
          </label>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend className="form-section__title">Scope</legend>
            <p className="form-section__copy">Teams and environments come from the project. They stay empty until a project is selected.</p>
            <div className="portal-form-grid">
          <label className="label">
            Project<span className="form-req" aria-hidden="true"> *</span>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code ? `${project.name} (${project.code})` : project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="label">
            Team<span className="form-req" aria-hidden="true"> *</span>
            <select className="input" value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)} required disabled={!projectId || envsLoading}>
              <option value="">{!projectId ? 'Select a project first' : envsLoading ? 'Loading teams...' : teams.length === 0 ? 'No teams' : 'Select team'}</option>
              {teams.map((t) => (
                <option key={t.id || t.slug} value={t.slug}>
                  {t.name && t.name !== t.slug ? `${t.name} (${t.slug})` : t.slug}
                </option>
              ))}
            </select>
            <span className="ig-muted" style={{ fontSize: 12 }}>
              {!projectId ? 'Select a project to load its teams.' : envsLoading ? 'Loading teams...' : teams.length === 0 ? 'This project has no teams.' : 'These are the teams on the selected project.'}
            </span>
          </label>
          <label className="label">
            Environments
            <select
              className="input"
              value=""
              disabled={!projectId || envsLoading || envOptions.length === 0}
              onChange={(event) => {
                const next = event.target.value;
                if (!next) return;
                setEnvironments((current) => (current.includes(next) ? current : [...current, next]));
              }}
            >
              <option value="">
                {!projectId
                  ? 'Select a project first'
                  : envsLoading
                    ? 'Loading environments...'
                    : envOptions.length === 0
                      ? 'No environments'
                      : 'Select environment'}
              </option>
              {envOptions.filter((env) => !environments.includes(env)).map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
            {environments.length > 0 ? (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {environments.map((env) => (
                  <button
                    key={env}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEnvironments((current) => current.filter((item) => item !== env))}
                  >
                    {env} · Remove
                  </button>
                ))}
              </span>
            ) : null}
            <span className="ig-muted" style={{ fontSize: 12 }}>
              {!projectId
                ? 'Select a project to load its environments.'
                : envsLoading
                  ? 'Loading environments...'
                  : envOptions.length === 0
                    ? 'This project has no environments.'
                    : 'Open the list and choose an environment. Add another the same way.'}
            </span>
          </label>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend className="form-section__title">Access</legend>
            <div className="portal-form-grid">
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
                <input className="input" type="password" autoComplete="off" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required placeholder={copy.rolePlaceholder} />
              </label>
              <label className="label">
                {copy.externalIdLabel}
                <input className="input" type="password" autoComplete="off" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder={copy.externalIdPlaceholder} />
              </label>
            </>
          ) : (
            <label className="label">
              Secret reference (env var name on API host)
              <input className="input" type="password" autoComplete="off" value={secretRef} onChange={(e) => setSecretRef(e.target.value)} required placeholder="CLOUD_ACCOUNT_PLATFORM_KEYS" />
            </label>
          )}
            </div>
          <p className="portal-surface__subtitle" style={{ margin: '12px 0 0' }}>
            The role, external ID, and secret reference are stored encrypted. The response returns the account you entered and whether those values are set. It does not return the values.
          </p>
          </fieldset>
          <div className="portal-form-actions">
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
