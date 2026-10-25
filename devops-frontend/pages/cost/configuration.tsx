import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import CostNav from '../../components/CostNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CostConfiguration, CostConnection, fetchCostJson, freshnessLabel, readinessLabel, sampleCUR2 } from '../../lib/cost';

export default function CostConfigurationPage() {
  const apiUrl = useApiUrl();
  const [data, setData] = useState<CostConfiguration | null>(null);
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [importConnection, setImportConnection] = useState('');
  const [importKind, setImportKind] = useState('import');
  const [importJSON, setImportJSON] = useState('');
  const [matchType, setMatchType] = useState('resource');
  const [matchValue, setMatchValue] = useState('');
  const [ruleTeam, setRuleTeam] = useState('');
  const [ruleService, setRuleService] = useState('');

  const load = () => {
    setLoading(true);
    fetchCostJson<CostConfiguration>(apiUrl, '/api/cost/configuration')
      .then((payload) => {
        setData(payload);
        setError('');
        setAccountId((current) => current || (payload.eligible?.[0] ? String(payload.eligible[0].id) : ''));
        setImportConnection((current) => current || (payload.connections?.[0] ? String(payload.connections[0].id) : ''));
        setImportJSON((current) => current || sampleCUR2(payload.connections?.[0]?.account_id || '123456789012'));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl]);

  const enable = async () => {
    setActing('enable');
    setNotice('');
    try {
      await fetchCostJson(apiUrl, '/api/cost/connections', {
        method: 'POST',
        body: JSON.stringify({ cloud_account_id: Number(accountId) }),
      });
      setNotice('Cost is enabled on that account. Billing stays Unknown until a fixture or export is imported.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cost could not be enabled.');
    } finally {
      setActing('');
    }
  };

  const importCUR = async () => {
    setActing('import');
    setNotice('');
    try {
      const parsed = JSON.parse(importJSON) as {
        label?: string;
        kind?: string;
        complete?: boolean;
        window_start?: string;
        window_end?: string;
        lines?: unknown;
      };
      const data = await fetchCostJson<{ note?: string }>(apiUrl, `/api/cost/connections/${importConnection}/import`, {
        method: 'POST',
        body: JSON.stringify({
          label: parsed.label,
          kind: importKind || parsed.kind || 'import',
          complete: parsed.complete !== false,
          window_start: parsed.window_start,
          window_end: parsed.window_end,
          lines: parsed.lines,
        }),
      });
      setNotice(data.note || 'CUR export stored.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CUR export could not be imported.');
    } finally {
      setActing('');
    }
  };

  const addRule = async () => {
    setActing('rule');
    setNotice('');
    try {
      await fetchCostJson(apiUrl, '/api/cost/allocation-rules', {
        method: 'POST',
        body: JSON.stringify({
          match_type: matchType,
          match_value: matchValue,
          team_slug: ruleTeam,
          service_name: ruleService,
        }),
      });
      setNotice('Allocation rule stored. Query-time mapping does not rewrite billed history.');
      setMatchValue('');
      setRuleTeam('');
      setRuleService('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allocation rule could not be saved.');
    } finally {
      setActing('');
    }
  };

  const removeRule = async (id: number) => {
    setActing(`rule-${id}`);
    setNotice('');
    try {
      await fetchCostJson(apiUrl, `/api/cost/allocation-rules/${id}`, { method: 'DELETE' });
      setNotice('Allocation rule removed. Next query uses the remaining order.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Allocation rule could not be removed.');
    } finally {
      setActing('');
    }
  };

  const importFixture = async (connection: CostConnection, complete: boolean) => {
    setActing(`${connection.id}-${complete ? 'complete' : 'incomplete'}`);
    setNotice('');
    try {
      const data = await fetchCostJson<{ note?: string; duplicate?: boolean }>(apiUrl, `/api/cost/connections/${connection.id}/fixture`, {
        method: 'POST',
        body: JSON.stringify({ complete }),
      });
      setNotice(data.note || (complete
        ? 'Complete fixture imported. Overview can show billed actual or amortized, never both added together.'
        : 'Incomplete fixture imported. Overview stays Unknown for that window.'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fixture could not be imported.');
    } finally {
      setActing('');
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Cost configuration</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <div>
            <h1 className="portal-page__title">Cost configuration</h1>
            <p className="cost-shell__hint">Enable Cost on an existing AWS account in a project you can see. This page does not store billing credentials.</p>
          </div>
        </div>
        <CostNav current="configuration" />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-info" role="status">{notice}</div> : null}
        <section className="portal-surface">
          <h2 className="portal-surface__title">Enable on an existing account</h2>
          <p className="portal-surface__subtitle">{data?.note}</p>
          {loading ? <div className="empty-state">Loading accounts…</div> : null}
          {!loading && data?.can_operate === false ? (
            <div className="empty-state">You can view spend. Cost operate is required to enable or import.</div>
          ) : null}
          {!loading && data?.can_operate !== false && !(data?.eligible || []).length ? (
            <div className="empty-state">No eligible AWS accounts in a project you can see. Assign the account to a project first, or Cost is already enabled on the ones you can see.</div>
          ) : null}
          {data?.ai_proof ? (
            <p className="portal-surface__subtitle">
              Copilot proofs: {data.ai_proof.safe ?? 0} safe, {data.ai_proof.blocked ?? 0} blocked. {data.ai_proof.note}
            </p>
          ) : null}
          {(data?.eligible || []).length && data?.can_operate !== false ? (
            <>
              <label className="label">Cloud account
                <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  {data!.eligible.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.display_name} · {account.project_code || account.project_name || 'Project'} · {account.account_id}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn btn-primary" disabled={!accountId || !!acting} onClick={() => void enable()}>
                {acting === 'enable' ? 'Enabling…' : 'Enable Cost'}
              </button>
            </>
          ) : null}
        </section>
        <section className="portal-surface portal-surface--table">
          <h2 className="portal-surface__title">Connections</h2>
          {!(data?.connections || []).length ? (
            <div className="empty-state">No Cost connections yet.</div>
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Billing</th>
                  <th>Inventory</th>
                  <th>Metrics</th>
                  <th>Freshness</th>
                  <th>Fixture</th>
                </tr>
              </thead>
              <tbody>
                {(data?.connections || []).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/cost/accounts/${row.id}`}>{row.display_name}</Link>
                      <div className="portal-surface__subtitle">{row.project_code || row.project_name || 'Project'} · {row.billing_source}</div>
                    </td>
                    <td>{readinessLabel(row.billing_readiness)}</td>
                    <td>{readinessLabel(row.inventory_readiness)}</td>
                    <td>{readinessLabel(row.metrics_readiness)}</td>
                    <td>{freshnessLabel(row.freshness)}</td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void importFixture(row, true)}>
                        Import complete
                      </button>{' '}
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void importFixture(row, false)}>
                        Import incomplete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Labelled AWS CUR 2.0 import</h2>
          <p className="portal-surface__subtitle">
            Paste CUR 2.0 JSON. Kind import, backfill, or correction. Backfill is limited to 13 months. A replay of the same export does not double spend. A correction supersedes the window and keeps history.
          </p>
          {!(data?.connections || []).length ? (
            <div className="empty-state">Enable Cost on an account first.</div>
          ) : (
            <>
              <div className="portal-form-grid">
                <label className="label">Connection
                  <select className="input" value={importConnection} onChange={(event) => {
                    const next = event.target.value;
                    setImportConnection(next);
                    const account = data?.connections.find((row) => String(row.id) === next);
                    if (account) setImportJSON(sampleCUR2(account.account_id));
                  }}>
                    {(data?.connections || []).map((row) => (
                      <option key={row.id} value={row.id}>{row.display_name} · {row.account_id}</option>
                    ))}
                  </select>
                </label>
                <label className="label">Kind
                  <select className="input" value={importKind} onChange={(event) => setImportKind(event.target.value)}>
                    <option value="import">Import</option>
                    <option value="backfill">Backfill</option>
                    <option value="correction">Correction</option>
                  </select>
                </label>
              </div>
              <label className="label">CUR 2.0 JSON
                <textarea className="input" rows={14} value={importJSON} onChange={(event) => setImportJSON(event.target.value)} />
              </label>
              <button type="button" className="btn btn-primary" disabled={!importConnection || !!acting || data?.can_operate === false} onClick={() => void importCUR()}>
                {acting === 'import' ? 'Importing…' : 'Import CUR export'}
              </button>
            </>
          )}
        </section>
        <section className="portal-surface">
          <h2 className="portal-surface__title">Allocation rules</h2>
          <p className="portal-surface__subtitle">
            Explicit resource, then product, then account, then CUR team tag, then the connection default, then Unallocated. Rules apply at query time and do not rewrite the ledger.
          </p>
          <div className="portal-form-grid">
            <label className="label">Match
              <select className="input" value={matchType} onChange={(event) => setMatchType(event.target.value)}>
                <option value="resource">Resource</option>
                <option value="product">Product</option>
                <option value="account">Account</option>
              </select>
            </label>
            <label className="label">Value
              <input className="input" value={matchValue} onChange={(event) => setMatchValue(event.target.value)} placeholder="i-0costc2api01" />
            </label>
            <label className="label">Team
              <input className="input" value={ruleTeam} onChange={(event) => setRuleTeam(event.target.value)} placeholder="platform-team" />
            </label>
            <label className="label">Portal service
              <input className="input" value={ruleService} onChange={(event) => setRuleService(event.target.value)} placeholder="payments-api" />
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={!matchValue || !!acting || data?.can_operate === false} onClick={() => void addRule()}>
            {acting === 'rule' ? 'Saving…' : 'Save rule'}
          </button>
          {(data?.rules || []).length ? (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Value</th>
                  <th>Team</th>
                  <th>Portal service</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.rules || []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.match_type}</td>
                    <td>{row.match_value}</td>
                    <td>{row.team_slug || 'Unallocated'}</td>
                    <td>{row.service_name || 'Unmapped'}</td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void removeRule(row.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="sre-meta__empty">No explicit rules yet. Tags and connection defaults still apply.</p>}
        </section>
        <section className="portal-surface portal-surface--table">
          <h2 className="portal-surface__title">Ingest history</h2>
          {!(data?.batches || []).length ? (
            <div className="empty-state">No imports yet. History is kept when a window is corrected.</div>
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th>Kind</th>
                  <th>Label</th>
                  <th>Window</th>
                  <th>Revision</th>
                </tr>
              </thead>
              <tbody>
                {(data?.batches || []).map((row) => (
                  <tr key={row.id}>
                    <td>{row.imported_at ? new Date(row.imported_at).toLocaleString() : 'Unknown'}</td>
                    <td>{row.display_name || row.account_id}</td>
                    <td>{row.kind}{row.supersedes_revision_id ? ' · supersedes prior' : ''}</td>
                    <td>{row.label || 'Unlabelled'}</td>
                    <td>{row.window_start} to {row.window_end}{row.complete ? '' : ' · incomplete'}</td>
                    <td>{row.revision || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </DevOpsLayout>
  );
}
