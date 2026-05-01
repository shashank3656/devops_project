import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import {
  IdleRemediation,
  IdleResource,
  IdleScan,
  cloudLabels,
  fmtUSD,
  idle,
  severityColor,
} from '../../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function ScanDetail() {
  const router = useRouter();
  const { id } = router.query;
  const scanId = Number(id);
  const { apiUrl } = useApiUrl();
  const [scan, setScan] = useState<IdleScan | null>(null);
  const [resources, setResources] = useState<IdleResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState<IdleResource | null>(null);

  const [fService, setFService] = useState('');
  const [fSeverity, setFSeverity] = useState('');
  const [fRegion, setFRegion] = useState('');
  const [fQuery, setFQuery] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remediations, setRemediations] = useState<IdleRemediation[]>([]);
  const [remOpen, setRemOpen] = useState(false);
  const [remBusy, setRemBusy] = useState(false);
  const [remError, setRemError] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(DEVOPS_TOKEN_KEY)) {
      router.replace('/login');
    }
  }, [router]);

  const load = useCallback(async () => {
    if (!scanId) return;
    setError('');
    try {
      const [s, r, rem] = await Promise.all([
        idle.getScan(apiUrl, scanId),
        idle.listResources(apiUrl, scanId, { service: fService, severity: fSeverity, region: fRegion, q: fQuery, limit: 1000 }),
        idle.listRemediations(apiUrl, scanId).catch(() => ({ remediations: [] })),
      ]);
      setScan(s.scan);
      setResources(r.resources);
      setRemediations(rem.remediations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, scanId, fService, fSeverity, fRegion, fQuery]);

  useEffect(() => { load(); }, [load]);

  // poll every 3s while running
  useEffect(() => {
    if (!scan) return;
    if (scan.status === 'pending' || scan.status === 'running') {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
  }, [scan, load]);

  const totals = useMemo(() => {
    const total = resources.reduce((acc, r) => acc + (r.cost_estimate_usd || 0), 0);
    const high = resources.filter((r) => r.severity === 'high').length;
    const services = new Set(resources.map((r) => r.service)).size;
    const regions = new Set(resources.map((r) => r.region)).size;
    return { total, high, services, regions };
  }, [resources]);

  const toggleSelect = (rid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === resources.length && resources.length > 0) return new Set();
      return new Set(resources.map((r) => r.resource_id));
    });
  };

  const selectedSavings = useMemo(() => {
    let total = 0;
    resources.forEach((r) => {
      if (selected.has(r.resource_id)) total += r.cost_estimate_usd || 0;
    });
    return total;
  }, [resources, selected]);

  const runRemediation = async (target: 'download' | 'github_pr' | 'jira_ticket', extras: { notes?: string; issue_type?: string; branch_name?: string } = {}) => {
    if (selected.size === 0) {
      setRemError('Select at least one resource first.');
      return;
    }
    setRemBusy(true);
    setRemError('');
    try {
      const res = await idle.createRemediation(apiUrl, scanId, {
        target,
        resource_ids: Array.from(selected),
        ...extras,
      });
      if (target === 'download' && res.remediation.cleanup_tf_url) {
        window.open(res.remediation.cleanup_tf_url, '_blank');
      } else if (target === 'github_pr' && res.remediation.pr_url) {
        window.open(res.remediation.pr_url, '_blank');
      } else if (target === 'jira_ticket' && res.remediation.ticket_url) {
        window.open(res.remediation.ticket_url, '_blank');
      }
      setRemOpen(false);
      setSelected(new Set());
      await load();
    } catch (err) {
      setRemError(err instanceof Error ? err.message : 'remediation failed');
    } finally {
      setRemBusy(false);
    }
  };

  const onRerank = async () => {
    if (!scan) return;
    try {
      const res = await idle.rerankScan(apiUrl, scan.id, {});
      alert(res.error ? `Fallback ranking applied: ${res.error}` : `Re-ranked ${res.ranked_count} items via ${res.provider}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rerank failed');
    }
  };

  if (loading || !scan) {
    return <DevOpsLayout><div style={{ padding: 32 }}>Loading…</div></DevOpsLayout>;
  }

  return (
    <DevOpsLayout>
      <Head><title>Scan #{scan.id} – Idle Resources</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
        <Link href="/idle-resources" style={{ color: '#6b7280', fontSize: 13 }}>← All scans</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 8 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Scan #{scan.id} · {scan.account_name}</h1>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              {cloudLabels[scan.cloud]} · {scan.regions.join(', ')} · status: <strong>{scan.status}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={idle.exportCsvUrl(apiUrl, scan.id)} target="_blank" rel="noreferrer" style={btnSecondary}>Download CSV</a>
            <a href={idle.exportXlsxUrl(apiUrl, scan.id)} target="_blank" rel="noreferrer" style={btnSecondary}>Download XLSX</a>
            <button style={btnSecondary} onClick={onRerank}>Re-rank with AI</button>
          </div>
        </div>

        {selected.size > 0 && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: '#111827', color: '#fff', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <strong>{selected.size}</strong> resource{selected.size > 1 ? 's' : ''} selected · est. <strong>{fmtUSD(selectedSavings)}</strong>/mo savings
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a href={idle.cleanupTfPreviewUrl(apiUrl, scanId, Array.from(selected))} target="_blank" rel="noreferrer" style={{ ...btnSecondary, background: 'transparent', color: '#fff', borderColor: '#374151' }}>Preview cleanup.tf</a>
              <button style={{ ...btnSecondary, background: '#fff', color: '#111827' }} onClick={() => { setRemError(''); setRemOpen(true); }}>Remediate…</button>
              <button style={{ ...btnSecondary, background: 'transparent', color: '#fff', borderColor: '#374151' }} onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 20 }}>
          <Stat label="Resources" value={String(resources.length)} />
          <Stat label="Monthly waste" value={fmtUSD(totals.total)} accent="#ef4444" />
          <Stat label="High severity" value={String(totals.high)} accent="#f59e0b" />
          <Stat label="Services / regions" value={`${totals.services} / ${totals.regions}`} />
        </div>

        {scan.error_log && Array.isArray(scan.error_log) && scan.error_log.length > 0 && (
          <div style={{ marginTop: 16, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e' }}>
            <strong>Partial errors:</strong>
            <ul style={{ margin: '6px 0 0 16px' }}>
              {scan.error_log.slice(0, 5).map((e, i) => <li key={i}>[{e.region}/{e.service}] {e.message}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
          <input style={smallInput} placeholder="Search name / id" value={fQuery} onChange={(e) => setFQuery(e.target.value)} />
          <select style={smallInput} value={fService} onChange={(e) => setFService(e.target.value)}>
            <option value="">All services</option>
            {Array.from(new Set(resources.map((r) => r.service))).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={smallInput} value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}>
            <option value="">All severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select style={smallInput} value={fRegion} onChange={(e) => setFRegion(e.target.value)}>
            <option value="">All regions</option>
            {scan.regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <table style={tableStyle}>
          <thead><tr style={{ background: '#f9fafb' }}>
            <th style={{ ...thStyle, width: 32 }}>
              <input type="checkbox"
                checked={selected.size === resources.length && resources.length > 0}
                onChange={toggleSelectAll}
                aria-label="Select all"
              />
            </th>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Service</th>
            <th style={thStyle}>Region</th>
            <th style={thStyle}>Resource</th>
            <th style={thStyle}>State</th>
            <th style={thStyle}>Severity</th>
            <th style={thStyle}>Monthly $</th>
            <th style={thStyle}>Reason</th>
          </tr></thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer', background: selected.has(r.resource_id) ? '#f0f9ff' : 'transparent' }}>
                <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(r.resource_id)} onChange={() => toggleSelect(r.resource_id)} aria-label="Select resource" />
                </td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>{r.ai_rank || '—'}</td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>{r.service}</td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>{r.region}</td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>
                  <div style={{ fontWeight: 500 }}>{r.name || r.resource_id}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{r.resource_id}</div>
                </td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>{r.state}</td>
                <td style={tdStyle} onClick={() => setDrawer(r)}><span style={{ background: severityColor(r.severity), color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{r.severity}</span></td>
                <td style={{ ...tdStyle, fontWeight: 600 }} onClick={() => setDrawer(r)}>{fmtUSD(r.cost_estimate_usd)}</td>
                <td style={tdStyle} onClick={() => setDrawer(r)}>{r.reason}</td>
              </tr>
            ))}
            {resources.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>No resources matched.</td></tr>
            )}
          </tbody>
        </table>

        {remediations.length > 0 && (
          <div style={{ marginTop: 24, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600 }}>Remediation history</h3>
            <table style={tableStyle}>
              <thead><tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Resources</th>
                <th style={thStyle}>Savings/mo</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Links</th>
              </tr></thead>
              <tbody>
                {remediations.map((rem) => (
                  <tr key={rem.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{new Date(rem.created_at).toLocaleString()}</td>
                    <td style={tdStyle}>{rem.target}</td>
                    <td style={tdStyle}>{rem.resource_ids.length}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtUSD(rem.estimated_savings_usd)}</td>
                    <td style={tdStyle}>
                      {rem.status === 'completed' ? <span style={{ color: '#059669' }}>✓ {rem.status}</span> : <span style={{ color: '#dc2626' }}>{rem.status}</span>}
                      {rem.error_message && <div style={{ fontSize: 11, color: '#991b1b', marginTop: 2 }}>{rem.error_message}</div>}
                    </td>
                    <td style={tdStyle}>
                      {rem.cleanup_tf_url && <a href={rem.cleanup_tf_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', marginRight: 8 }}>cleanup.tf</a>}
                      {rem.pr_url && <a href={rem.pr_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', marginRight: 8 }}>PR</a>}
                      {rem.ticket_url && <a href={rem.ticket_url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>{rem.ticket_key || 'Ticket'}</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {remOpen && (
          <RemediationDialog
            count={selected.size}
            savings={selectedSavings}
            busy={remBusy}
            error={remError}
            onClose={() => setRemOpen(false)}
            onSubmit={runRemediation}
          />
        )}

        {drawer && <Drawer resource={drawer} onClose={() => setDrawer(null)} />}
      </div>
    </DevOpsLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px' }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, color: accent || '#111827' }}>{value}</div>
    </div>
  );
}

function Drawer({ resource, onClose }: { resource: IdleResource; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <aside style={{ width: 480, background: '#fff', height: '100%', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', float: 'right' }}>×</button>
        <h3 style={{ margin: 0, fontSize: 18 }}>{resource.name || resource.resource_id}</h3>
        <div style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 12 }}>{resource.resource_id}</div>
        <div style={{ marginTop: 20, display: 'grid', gap: 10, fontSize: 14 }}>
          <Row k="Cloud / service" v={`${cloudLabels[resource.cloud]} · ${resource.service}`} />
          <Row k="Region" v={resource.region} />
          <Row k="State" v={resource.state} />
          <Row k="Monthly waste" v={fmtUSD(resource.cost_estimate_usd)} />
          <Row k="Severity" v={resource.severity} />
          <Row k="Reason" v={resource.reason} />
          {resource.ai_rank && <Row k="AI rank" v={String(resource.ai_rank)} />}
          {resource.ai_recommendation && <Row k="AI note" v={resource.ai_recommendation} />}
          <Row k="Tags" v={Object.entries(resource.tags || {}).map(([k, v]) => `${k}=${v}`).join('  ') || '—'} />
        </div>
        {resource.metrics && Object.keys(resource.metrics).length > 0 && (
          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Metrics</summary>
            <pre style={{ background: '#f9fafb', padding: 12, borderRadius: 8, fontSize: 12, marginTop: 8 }}>{JSON.stringify(resource.metrics, null, 2)}</pre>
          </details>
        )}
        {resource.console_url && (
          <a href={resource.console_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 20, padding: '10px 16px', borderRadius: 8, background: '#111827', color: '#fff', textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            Open in cloud console →
          </a>
        )}
      </aside>
    </div>
  );
}

function RemediationDialog({
  count,
  savings,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  count: number;
  savings: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (target: 'download' | 'github_pr' | 'jira_ticket', extras: { notes?: string; issue_type?: string; branch_name?: string }) => void;
}) {
  const [tab, setTab] = useState<'download' | 'github_pr' | 'jira_ticket'>('download');
  const [notes, setNotes] = useState('');
  const [issueType, setIssueType] = useState('Task');
  const [branchName, setBranchName] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 200 }} onClick={onClose}>
      <aside style={{ width: 520, background: '#fff', height: '100%', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', float: 'right' }}>×</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Remediate {count} resource{count > 1 ? 's' : ''}</h2>
        <p style={{ color: '#6b7280', marginTop: 4 }}>Estimated savings: <strong>{fmtUSD(savings)}/mo</strong></p>

        <div style={{ display: 'flex', gap: 4, marginTop: 20, padding: 4, background: '#f3f4f6', borderRadius: 10 }}>
          {(['download', 'github_pr', 'jira_ticket'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#111827' : '#6b7280', boxShadow: tab === t ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}>
              {t === 'download' ? 'Download' : t === 'github_pr' ? 'GitHub PR' : 'Jira ticket'}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          {tab === 'download' && (
            <div>
              <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>
                Generate <code>cleanup.tf</code> and store it in Supabase. You&apos;ll get a download link to apply via your Terraform pipeline.
              </p>
            </div>
          )}
          {tab === 'github_pr' && (
            <div>
              <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>
                Open a pull request against the configured GitOps repo with the generated <code>cleanup.tf</code>.
              </p>
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Branch name (optional)</label>
                <input style={inputStyle} placeholder="idle-cleanup/scan-…" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
              </div>
            </div>
          )}
          {tab === 'jira_ticket' && (
            <div>
              <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>
                Create a Jira issue summarising the resources to delete. Requires <code>JIRA_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_TOKEN</code>, and <code>JIRA_PROJECT</code> env vars on the backend.
              </p>
              <div style={{ marginTop: 14 }}>
                <label style={labelStyle}>Issue type</label>
                <input style={inputStyle} value={issueType} onChange={(e) => setIssueType(e.target.value)} placeholder="Task" />
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why are these idle?" />
          </div>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            style={{ ...btnSecondary, background: '#111827', color: '#fff', borderColor: '#111827' }}
            onClick={() => onSubmit(tab, { notes, issue_type: issueType, branch_name: branchName })}
            disabled={busy || count === 0}
          >
            {busy ? 'Working…' : tab === 'download' ? 'Generate cleanup.tf' : tab === 'github_pr' ? 'Open pull request' : 'Create Jira ticket'}
          </button>
        </div>
      </aside>
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' };

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
      <div style={{ color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</div>
      <div>{v}</div>
    </div>
  );
}

const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, background: '#fff', color: '#111827', fontWeight: 500, fontSize: 13, border: '1px solid #d1d5db', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const smallInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 };
const tableStyle: React.CSSProperties = { width: '100%', marginTop: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, borderCollapse: 'separate', borderSpacing: 0, overflow: 'hidden' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 13 };
const errorBox: React.CSSProperties = { marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
