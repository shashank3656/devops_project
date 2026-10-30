import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  loadCertificateMembers,
  loadCertificateTeams,
  type CertificateMemberOption,
  type CertificateTeamOption,
} from '../../lib/certificateOwnership';

const TOKEN_KEY = 'devops_token';

type ProjectOption = { id: number; name: string };
type Suggestion = {
  hostname: string;
  registered: boolean;
  source?: string;
  cluster?: string;
  namespace?: string;
  issued_not_served?: boolean;
  collector_hint?: string;
  note?: string;
};

export default function NewCertificateAssetPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [assetType, setAssetType] = useState('certificate');
  const [input, setInput] = useState('');
  const [port, setPort] = useState('443');
  const [projectId, setProjectId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [service, setService] = useState('');
  const [environment, setEnvironment] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [runbook, setRunbook] = useState('');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [teams, setTeams] = useState<CertificateTeamOption[]>([]);
  const [members, setMembers] = useState<CertificateMemberOption[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [warnPolicy, setWarnPolicy] = useState('standard');
  const [collector, setCollector] = useState('hosted');

  useEffect(() => {
    if (!router.isReady) return;
    const query = router.query;
    if (typeof query.hostname === 'string' && query.hostname) setInput(query.hostname);
    if (query.asset_type === 'certificate' || query.asset_type === 'domain') setAssetType(query.asset_type);
    if (typeof query.project_id === 'string' && query.project_id) setProjectId(query.project_id);
    if (typeof query.service === 'string' && query.service) setService(query.service);
    if (typeof query.environment === 'string' && query.environment) setEnvironment(query.environment);
    if (typeof query.collector === 'string' && query.collector) setCollector(query.collector);
  }, [router.isReady, router.query]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/devops/projects`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        const rows = Array.isArray(data?.projects) ? data.projects : [];
        setProjects(rows.map((row: { id?: number; name?: string }) => ({ id: Number(row.id) || 0, name: String(row.name || 'Unknown') })).filter((row: ProjectOption) => row.id > 0));
      })
      .catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    let cancelled = false;
    setTeamsLoading(true);
    loadCertificateTeams(apiUrl, token, projectId)
      .then((rows) => {
        if (!cancelled) setTeams(rows);
      })
      .catch(() => {
        if (!cancelled) setTeams([]);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, projectId]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !teamId) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    loadCertificateMembers(apiUrl, token, teamId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, teamId]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || assetType !== 'certificate') {
      setSuggestions([]);
      return;
    }
    const params = projectId ? `?project_id=${projectId}` : '';
    fetch(`${apiUrl}/api/expiry/assets/suggestions${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []))
      .catch(() => setSuggestions([]));
  }, [apiUrl, assetType, projectId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/expiry/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          asset_type: assetType,
          input,
          port: assetType === 'certificate' ? Number(port) || 443 : 0,
          project_id: Number(projectId) || 0,
          team_id: Number(teamId) || 0,
          service_name: service,
          environment,
          owner_user_id: Number(ownerUserId) || 0,
          runbook_url: runbook,
          collector: assetType === 'certificate' ? collector : 'hosted',
          warn_days: warnPolicy === 'short' ? [7, 3, 1] : [30, 14, 7, 3, 1],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'That endpoint or domain could not be registered.');
        return;
      }
      const id = Number(data.asset?.id);
      if (id > 0) {
        await router.push(`/certificates/${id}`);
        return;
      }
      await router.push('/certificates');
    } catch {
      setError('That endpoint or domain could not be registered.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Register certificate or domain</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Register asset</h1>
            <p className="portal-page__subtitle">Registering a hosted certificate resolves DNS, connects to the public endpoint, and stores leaf expiry on this record. Domain registration queries RDAP, then WHOIS if needed, resolves DNS, and stores the published expiry. There is no private-key upload.</p>
          </div>
          <Link href="/certificates" className="btn btn-secondary">Back</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <form className="portal-surface expiry-panel" onSubmit={submit}>
          {step === 1 ? (
            <>
              <h2 className="portal-surface__title">Scope and asset</h2>
              <p className="access-hint">{assetType === 'certificate' ? 'Tracks the TLS leaf NotAfter on the served endpoint.' : 'Tracks one domain registration expiry from RDAP and WHOIS. DNS confirms the name resolves. That is not the HTTPS certificate.'}</p>
              <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Asset type
                <select className="input" value={assetType} onChange={(event) => setAssetType(event.target.value)}>
                  <option value="certificate">Certificate endpoint</option>
                  <option value="domain">Registered domain</option>
                </select>
              </label>
              <label className="label">{assetType === 'certificate' ? 'Hostname' : 'Domain'}
                <input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={assetType === 'certificate' ? 'app.example.com' : 'example.com'} required />
              </label>
              {assetType === 'certificate' ? (
                <label className="label">Port
                  <select className="input" value={port} onChange={(event) => setPort(event.target.value)}>
                    <option value="443">443</option>
                    <option value="8443">8443</option>
                  </select>
                </label>
              ) : null}
              <label className="label">Project
                <select className="input" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">Select a project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="label">Environment
                <input className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="production" />
              </label>
              <label className="label">Service
                <input className="input" value={service} onChange={(event) => setService(event.target.value)} />
              </label>
              </div>
              {assetType === 'certificate' && suggestions.length ? (
                <div>
                  <p className="access-hint">Suggested from Kubernetes ingress, cert-manager, and certificate-manager inventory. Registering is still a choice. Issued is not served.</p>
                  <ul>
                    {suggestions.slice(0, 16).map((row) => (
                      <li key={`${row.source || 'host'}-${row.hostname}`}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setInput(row.hostname);
                            if (row.collector_hint === 'private') setCollector('private');
                          }}
                        >
                          {row.hostname}
                        </button>
                        {row.registered ? ' · already registered' : ''}
                        {row.source === 'certificate_manager' ? ' · cert-manager issued' : ''}
                        {row.source === 'cloud_certificate_manager' ? ' · cloud issued inventory' : ''}
                        {row.issued_not_served ? ' · issued ≠ served' : ''}
                        {row.collector_hint === 'private' ? ' · private collector' : ''}
                        {row.namespace ? ` · ${row.namespace}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="portal-form-actions">
                <button type="button" className="btn btn-primary" onClick={() => setStep(2)} disabled={!input.trim()}>Continue</button>
              </div>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <h2 className="portal-surface__title">Ownership and policy</h2>
              <div className="portal-field-grid portal-field-grid--two">
              <label className="label">Team
                <select className="input" value={teamId} onChange={(event) => { setTeamId(event.target.value); setOwnerUserId(''); }} disabled={teamsLoading}>
                  <option value="">{teamsLoading ? 'Loading teams…' : 'Select a team'}</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="label">Owner
                <select className="input" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} disabled={!teamId || membersLoading}>
                  <option value="">{!teamId ? 'Select a team first' : membersLoading ? 'Loading members…' : 'Select an owner'}</option>
                  {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
                </select>
              </label>
              <label className="label">Reminder windows
                <select className="input" value={warnPolicy} onChange={(event) => setWarnPolicy(event.target.value)}>
                  <option value="standard">Standard: 30, 14, 7, 3, and 1 days</option>
                  <option value="short">Short-lived certificate: 7, 3, and 1 days</option>
                </select>
              </label>
              <label className="label">Renewal runbook URL
                <input className="input" value={runbook} onChange={(event) => setRunbook(event.target.value)} />
              </label>
              {assetType === 'certificate' ? (
                <label className="label">Collector
                  <select className="input" value={collector} onChange={(event) => setCollector(event.target.value)}>
                    <option value="hosted">Hosted collector (public endpoints)</option>
                    <option value="private">Private collector (internal names)</option>
                  </select>
                </label>
              ) : null}
              </div>
              {!teamsLoading && !teams.length ? <p className="access-hint">No teams were returned for this workspace.</p> : null}
              <p className="access-hint">Owner is a team member name only. Emails are not shown.</p>
              {teamId && !membersLoading && !members.length ? <p className="access-hint">This team has no members.</p> : null}
              <p className="access-hint">
                {collector === 'private'
                  ? `Private collector: ${input || 'hostname'}:${port}. Hosted checks will not reach this target. Coverage stays Unknown until the collector posts an observation. Private keys are not accepted.`
                  : assetType === 'domain'
                    ? `Hosted collector: public ${input || 'domain'}. RDAP/WHOIS captures registration expiry. DNS is resolved separately. Private ranges are rejected.`
                    : `Hosted collector: public ${input || 'hostname'}:${port}. DNS is resolved, the endpoint is connected, and expiry is stored on this record. Private ranges are rejected.`}
              </p>
              <div className="portal-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving
                    ? (collector === 'private' ? 'Registering…' : assetType === 'domain' ? 'Querying WHOIS and DNS…' : 'Connecting and checking DNS…')
                    : collector === 'private'
                      ? 'Register for private collector'
                      : assetType === 'domain'
                        ? 'Register, query expiry, and store'
                        : 'Register, connect, and store expiry'}
                </button>
              </div>
            </>
          ) : null}
        </form>
      </div>
    </DevOpsLayout>
  );
}
