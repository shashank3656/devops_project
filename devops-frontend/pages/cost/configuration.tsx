import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import CostFirstRun from '../../components/CostFirstRun';
import CostFreshnessStrip from '../../components/CostFreshnessStrip';
import CostNav from '../../components/CostNav';
import CostSearchSelect from '../../components/CostSearchSelect';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { COST_TOKEN_KEY, CostConfiguration, CostConnection, fetchCostJson, freshnessLabel, readinessLabel, sampleCUR2, validateCostAllocation } from '../../lib/cost';

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
  const [teamOptions, setTeamOptions] = useState<{ name: string; slug: string }[]>([]);
  const [serviceOptions, setServiceOptions] = useState<string[]>([]);

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

  const teamChoices = useMemo(() => {
    const map = new Map<string, { value: string; label: string }>();
    teamOptions.forEach((row) => {
      const value = row.slug || row.name;
      if (value) map.set(value, { value, label: row.name || row.slug });
    });
    (data?.connections || []).forEach((row) => {
      if (row.team_slug && !map.has(row.team_slug)) {
        map.set(row.team_slug, { value: row.team_slug, label: row.team_slug });
      }
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [teamOptions, data]);

  const serviceChoices = useMemo(
    () => serviceOptions.map((name) => ({ value: name, label: name })),
    [serviceOptions],
  );

  useEffect(() => {
    load();
  }, [apiUrl]);

  useEffect(() => {
    const token = typeof window === 'undefined' ? '' : localStorage.getItem(COST_TOKEN_KEY) || '';
    const headers = { Authorization: token ? `Bearer ${token}` : '' };
    fetch(`${apiUrl}/api/devops/my-teams`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json()) as { teams?: { name?: string; slug?: string }[] };
        const rows = Array.isArray(payload.teams) ? payload.teams : [];
        setTeamOptions(
          rows
            .map((row) => ({
              name: String(row.name || '').trim(),
              slug: String(row.slug || '').trim(),
            }))
            .filter((row) => row.name),
        );
      })
      .catch(() => setTeamOptions([]));
    fetch(`${apiUrl}/api/devops/services?view=summary`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json()) as { services?: { service?: string; name?: string }[]; items?: { service?: string; name?: string }[] };
        const rows = Array.isArray(payload.services)
          ? payload.services
          : Array.isArray(payload.items)
            ? payload.items
            : [];
        const names = rows
          .map((row) => String(row.service || row.name || '').trim())
          .filter((row): row is string => Boolean(row));
        setServiceOptions([...new Set(names)].sort());
      })
      .catch(() => setServiceOptions([]));
  }, [apiUrl]);

  const enable = async () => {
    setActing('enable');
    setNotice('');
    try {
      await fetchCostJson(apiUrl, '/api/cost/connections', {
        method: 'POST',
        body: JSON.stringify({ cloud_account_id: Number(accountId) }),
      });
      setNotice('Cost is enabled on that account. Spend stays Unknown until billed data is imported.');
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
    const invalid = validateCostAllocation(matchType, matchValue, ruleTeam, ruleService);
    if (invalid) {
      setError(invalid);
      return;
    }
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

  const testConnection = async (connection: CostConnection) => {
    setActing(`test-${connection.id}`);
    setNotice('');
    try {
      const payload = await fetchCostJson<{ collection?: { note?: string } }>(apiUrl, `/api/cost/connections/${connection.id}/test`, {
        method: 'POST',
        body: '{}',
      });
      setNotice(payload.collection?.note || 'Connection test finished. Newer provider billing was not pulled.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test could not run.');
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
        ? 'Complete billed data imported. Overview can show billed actual or amortized, never both added together.'
        : 'Incomplete billed data imported. Overview stays Unknown for that window.'));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billed data could not be imported.');
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
            <p className="cost-shell__hint">
              {typeof data?.pilot === 'object' && data.pilot?.note
                ? data.pilot.note
                : 'Pilot: labelled AWS CUR 2.0 import. This page does not store billing credentials and does not pull CUR automatically.'}
            </p>
          </div>
        </div>
        <CostNav current="configuration" />
        <CostFreshnessStrip detail={data?.freshness_detail} />
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-info" role="status">{notice}</div> : null}
        <section className="portal-surface">
          <h2 className="portal-surface__title">Enable on an existing account</h2>
          <p className="portal-surface__subtitle">{data?.note}</p>
          {loading ? <div className="empty-state">Loading accounts…</div> : null}
          {!loading && data?.can_operate === false ? (
            <div className="empty-state">You can view spend. Cost operate is required to enable or import.</div>
          ) : null}
          {!loading && data?.can_operate !== false && !(data?.eligible || []).length && !(data?.connections || []).length ? (
            <CostFirstRun canOperate title="No AWS accounts in a project you can see" primaryHref="/cloud-accounts" primaryLabel="Open cloud accounts" />
          ) : null}
          {!loading && data?.can_operate !== false && !(data?.eligible || []).length && (data?.connections || []).length ? (
            <div className="empty-state">
              Cost is already enabled on every AWS account you can operate. Ingest billed data on a connection below.
            </div>
          ) : null}
          {data?.ai_proof ? (
            <CostTechnicalDetails>
              <p>Assistant checks: {data.ai_proof.safe ?? 0} allowed, {data.ai_proof.blocked ?? 0} blocked. {data.ai_proof.note}</p>
            </CostTechnicalDetails>
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
          <h2 className="portal-surface__title">Collection</h2>
          <p className="portal-surface__subtitle">On-demand labelled import only. Schedule stays Not scheduled until automated collection exists.</p>
          {!(data?.collection || []).length ? (
            <div className="empty-state">Enable Cost on an account to see source configuration and last success.</div>
          ) : (
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Test</th>
                  <th>Schedule</th>
                  <th>Last success</th>
                  <th>Next run</th>
                  <th>Retry</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(data?.collection || []).map((row) => {
                  const connection = (data?.connections || []).find((item) => item.id === row.connection_id);
                  return (
                    <tr key={row.connection_id}>
                      <td>{row.configuration || row.source}</td>
                      <td>{row.connection_test?.status || 'Unknown'}</td>
                      <td>{row.schedule || 'On demand'}</td>
                      <td>{row.last_success ? new Date(row.last_success).toLocaleString() : 'Unknown'}</td>
                      <td>{row.next_run || 'Not scheduled'}</td>
                      <td>{row.retry_status || 'idle'}</td>
                      <td>
                        {connection ? (
                          <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void testConnection(connection)}>
                            Test connection
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
                  <th>Billed data</th>
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
                        Import complete bill
                      </button>{' '}
                      <button type="button" className="btn btn-secondary btn-sm" disabled={!!acting || data?.can_operate === false} onClick={() => void importFixture(row, false)}>
                        Import incomplete bill
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
            {data?.allocation_note || 'Rules are versioned. Editing stores a new effective date so previously billed days keep the ownership that was in force then.'}
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
              <input
                className="input"
                value={matchValue}
                onChange={(event) => setMatchValue(event.target.value)}
                placeholder={matchType === 'account' ? '12-digit account' : matchType === 'product' ? 'Product name' : 'Resource identifier'}
              />
            </label>
            <CostSearchSelect
              id="cost-team"
              label="Team"
              value={ruleTeam}
              onChange={setRuleTeam}
              options={teamChoices}
              placeholder="Search teams you can use"
            />
            <CostSearchSelect
              id="cost-service"
              label="Portal service"
              value={ruleService}
              onChange={setRuleService}
              options={serviceChoices}
              placeholder="Search services you can see"
            />
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
                  <th>Effective</th>
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
                    <td>{row.effective_from || 'Current'}{row.version ? ` · v${row.version}` : ''}</td>
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
