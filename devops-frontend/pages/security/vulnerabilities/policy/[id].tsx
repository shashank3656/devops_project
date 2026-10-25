import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import DevOpsLayout from '../../../../components/DevOpsLayout';
import { useApiUrl } from '../../../../context/ApiUrlContext';
import { accessLabel, asRows, collectionModeLabel, queryText, vulnRequest } from '../../../../lib/securityVuln';

type RepoConfig = {
  id: number;
  repository: string;
  provider?: string;
  collection_mode: string;
  owner_team?: string;
  schedule_minutes: number;
  alert_min_severity: string;
  allow_fork_prs: boolean;
  enforce_pr_gate?: boolean;
  exclusions?: string;
  branch: string;
  access_state?: string;
  access_detail?: string;
  last_scheduled_at?: string;
};

export default function VulnPolicyDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(queryText(router.query.id));
  const [repo, setRepo] = useState<RepoConfig | null>(null);
  const [mode, setMode] = useState('hosted');
  const [branch, setBranch] = useState('main');
  const [team, setTeam] = useState('');
  const [schedule, setSchedule] = useState('0');
  const [exclusions, setExclusions] = useState('');
  const [forks, setForks] = useState(false);
  const [gate, setGate] = useState(false);
  const [alert, setAlert] = useState('high');
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [repoRes, meRes] = await Promise.all([
      vulnRequest(apiUrl, '/api/devops/security/repositories?probe=1'),
      vulnRequest(apiUrl, '/api/devops/me'),
    ]);
    const profile = meRes.body.devops_profile as { is_manager?: boolean } | undefined;
    const role = typeof meRes.body.role === 'string' ? meRes.body.role : '';
    setIsManager(Boolean(profile?.is_manager) || role === 'admin');
    if (repoRes.status !== 200) {
      setError(typeof repoRes.body.error === 'string' ? repoRes.body.error : 'Repository policy could not be loaded.');
      setRepo(null);
      return;
    }
    const item = asRows<RepoConfig>(repoRes.body.repositories).find((row) => row.id === id) || null;
    if (!item) {
      setError('That repository was not found in your authorized projects.');
      setRepo(null);
      return;
    }
    setRepo(item);
    setMode(item.collection_mode || 'hosted');
    setBranch(item.branch || 'main');
    setTeam(item.owner_team || '');
    setSchedule(String(item.schedule_minutes || 0));
    setExclusions(item.exclusions || '');
    setForks(Boolean(item.allow_fork_prs));
    setGate(Boolean(item.enforce_pr_gate));
    setAlert(item.alert_min_severity || 'high');
  }, [apiUrl, id]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [load, router.isReady]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!isManager) {
      setError('Saving policy needs a manager role.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const result = await vulnRequest(apiUrl, `/api/devops/security/repositories/${id}`, 'PATCH', {
      collection_mode: mode,
      owner_team: team,
      alert_min_severity: alert,
      schedule_minutes: Number(schedule) || 0,
      allow_fork_prs: forks,
      enforce_pr_gate: gate,
      exclusions,
      branch: branch.trim(),
    });
    setBusy(false);
    if (result.status !== 200) {
      setError(typeof result.body.error === 'string' ? result.body.error : 'Repository policy could not be saved.');
      return;
    }
    setNotice('Repository policy saved. Hosted tokens stay on the API.');
    await load();
  }

  return (
    <DevOpsLayout>
      <Head>
        <title>{repo ? `${repo.repository} policy` : 'Repository policy'} - OpsTrellis</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Security</span>
            <h1 className="portal-page__title">{repo?.repository || 'Repository policy'}</h1>
            <p className="portal-page__subtitle">Collection, schedule, and alerts. Hosted collector never executes package scripts. This form never displays secret values.</p>
          </div>
          <Link className="btn btn-secondary" href="/security/vulnerabilities?tab=configuration">Back to Config</Link>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {repo ? (
          <>
            <dl className="sre-meta">
              <div className="sre-meta__item"><dt>Collection</dt><dd>{collectionModeLabel(mode)}</dd></div>
              <div className="sre-meta__item"><dt>Token</dt><dd><span title={repo.access_detail || ''}>{accessLabel(repo.access_state)}</span></dd></div>
              <div className="sre-meta__item"><dt>Last scheduled</dt><dd>{repo.last_scheduled_at ? formatOperationalTime(repo.last_scheduled_at) : 'Never'}</dd></div>
              <div className="sre-meta__item"><dt>Provider</dt><dd>{repo.provider || 'github'}</dd></div>
            </dl>
            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <h2 className="portal-surface__title">Policy</h2>
                  <p className="portal-surface__subtitle">Saving policy needs a manager role. OpsTrellis does not merge pull requests and does not patch production.</p>
                </div>
              </div>
              <form className="portal-form-grid" onSubmit={(event) => void onSave(event)}>
                <label className="label">Collection mode
                  <select className="input" value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="hosted">Hosted collector</option>
                    <option value="agent">Private outbound agent</option>
                    <option value="ci">CI inventory / SBOM upload</option>
                  </select>
                </label>
                <label className="label">Branch<input className="input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" /></label>
                <label className="label">Owner team<input className="input" value={team} onChange={(event) => setTeam(event.target.value)} placeholder="Team that owns this repository" /></label>
                <label className="label">Alert from severity
                  <select className="input" value={alert} onChange={(event) => setAlert(event.target.value)}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                  </select>
                </label>
                <label className="label">Schedule minutes<input className="input" value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label>
                <label className="label">Path exclusions<input className="input" value={exclusions} onChange={(event) => setExclusions(event.target.value)} placeholder="docs/, vendor/" /></label>
                <label className="sec-vuln-check"><input type="checkbox" checked={forks} onChange={(event) => setForks(event.target.checked)} /> Allow fork pull requests</label>
                <label className="sec-vuln-check"><input type="checkbox" checked={gate} onChange={(event) => setGate(event.target.checked)} /> Enforce comparison gate (does not merge)</label>
                <p className="form-section__copy">Hosted collector runs due jobs every five minutes when schedule is 15 or more. Agents and CI are not kicked from this schedule.</p>
                <div className="portal-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={busy || !isManager}>Save policy</button>
                  <Link className="btn btn-secondary" href="/security/vulnerabilities/policy">Choose another repository</Link>
                </div>
              </form>
              {!isManager ? <p className="form-section__copy">Saving policy needs a manager role.</p> : null}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
