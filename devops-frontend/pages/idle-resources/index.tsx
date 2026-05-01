import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  CloudAccount,
  IdleScan,
  IdleSummary,
  cloudLabels,
  fmtUSD,
  idle,
} from '../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function IdleResourcesIndex() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [scans, setScans] = useState<IdleScan[]>([]);
  const [summary, setSummary] = useState<IdleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(DEVOPS_TOKEN_KEY)) {
      router.replace('/login');
    }
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, s, sm] = await Promise.all([
        idle.listAccounts(apiUrl),
        idle.listScans(apiUrl),
        idle.summary(apiUrl).catch(() => null),
      ]);
      setAccounts(a.accounts);
      setScans(s.scans);
      if (sm) setSummary({ accounts: sm.accounts, recent_scans: sm.recent_scans, monthly_waste: sm.monthly_waste, high_severity: sm.high_severity });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { load(); }, [load]);

  return (
    <DevOpsLayout>
      <Head><title>Idle Resources</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Idle Resources</h1>
            <p style={{ color: '#6b7280', marginTop: 4 }}>
              Multi-cloud FinOps audit. Connect an account, run a scan, and find what to delete first.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/idle-resources/audit" style={btnSecondary}>Audit log</Link>
            <Link href="/idle-resources/settings" style={btnSecondary}>Settings</Link>
            <Link href="/idle-resources/accounts/new" style={btnPrimary}>+ Connect cloud account</Link>
          </div>
        </div>

        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 24 }}>
            <SummaryCard label="Active accounts" value={String(summary.accounts)} />
            <SummaryCard label="Scans (30d)" value={String(summary.recent_scans)} />
            <SummaryCard label="Monthly waste (latest)" value={fmtUSD(summary.monthly_waste)} accent="#ef4444" />
            <SummaryCard label="High severity" value={String(summary.high_severity)} accent="#f59e0b" />
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}

        <section style={{ marginTop: 32 }}>
          <div style={sectionHeader}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Cloud accounts</h2>
            <span style={{ color: '#6b7280', fontSize: 13 }}>{accounts.length} connected</span>
          </div>
          {accounts.length === 0 && !loading ? (
            <EmptyState
              title="No cloud accounts yet"
              hint="Connect AWS, Azure or GCP to start scanning for idle resources."
              cta={<Link href="/idle-resources/accounts/new" style={btnPrimary}>Connect your first account</Link>}
            />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={trHead}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Cloud</th>
                  <th style={thStyle}>Auth</th>
                  <th style={thStyle}>Default regions</th>
                  <th style={thStyle}>Last test</th>
                  <th style={thStyle}>Last scan</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} style={trBody}>
                    <td style={tdStyle}><Link href={`/idle-resources/accounts/${a.id}`} style={{ color: '#3b82f6', fontWeight: 500 }}>{a.name}</Link></td>
                    <td style={tdStyle}>{cloudLabels[a.cloud]}</td>
                    <td style={tdStyle}><code style={codeStyle}>{a.auth_method}</code></td>
                    <td style={tdStyle}>{a.default_regions.join(', ') || <span style={{ color: '#9ca3af' }}>none</span>}</td>
                    <td style={tdStyle}>
                      {a.last_test_status ? (
                        <span style={{ color: a.last_test_status === 'ok' ? '#10b981' : '#ef4444' }}>{a.last_test_status}</span>
                      ) : <span style={{ color: '#9ca3af' }}>not tested</span>}
                    </td>
                    <td style={tdStyle}>{a.last_scan_at ? new Date(a.last_scan_at).toLocaleString() : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <Link href={`/idle-resources/accounts/${a.id}`} style={linkBtn}>Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section style={{ marginTop: 32 }}>
          <div style={sectionHeader}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Recent scans</h2>
          </div>
          {scans.length === 0 && !loading ? (
            <EmptyState title="No scans yet" hint="Once you connect an account, kick off a scan from its detail page." />
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={trHead}>
                  <th style={thStyle}>Scan</th>
                  <th style={thStyle}>Account</th>
                  <th style={thStyle}>Cloud</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Started</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id} style={trBody}>
                    <td style={tdStyle}>#{s.id}</td>
                    <td style={tdStyle}>{s.account_name}</td>
                    <td style={tdStyle}>{cloudLabels[s.cloud]}</td>
                    <td style={tdStyle}><StatusPill status={s.status} /></td>
                    <td style={tdStyle}>{s.started_at ? new Date(s.started_at).toLocaleString() : new Date(s.created_at).toLocaleString()}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <Link href={`/idle-resources/scans/${s.id}`} style={linkBtn}>View →</Link>
                    </td>
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

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6, color: accent || '#111827' }}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    pending: { bg: '#fef3c7', fg: '#92400e' },
    running: { bg: '#dbeafe', fg: '#1e3a8a' },
    complete: { bg: '#d1fae5', fg: '#065f46' },
    complete_with_errors: { bg: '#fef3c7', fg: '#92400e' },
    failed: { bg: '#fee2e2', fg: '#991b1b' },
    cancelled: { bg: '#e5e7eb', fg: '#374151' },
  };
  const p = palette[status] || palette.pending;
  return <span style={{ background: p.bg, color: p.fg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500 }}>{status}</span>;
}

function EmptyState({ title, hint, cta }: { title: string; hint?: string; cta?: React.ReactNode }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 12, padding: '40px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 500 }}>{title}</div>
      {hint && <div style={{ color: '#6b7280', marginTop: 4 }}>{hint}</div>}
      {cta && <div style={{ marginTop: 16 }}>{cta}</div>}
    </div>
  );
}

const btnPrimary: React.CSSProperties = { padding: '10px 16px', borderRadius: 8, background: '#111827', color: '#fff', textDecoration: 'none', fontWeight: 500, fontSize: 14, border: 'none' };
const btnSecondary: React.CSSProperties = { padding: '10px 16px', borderRadius: 8, background: '#fff', color: '#111827', textDecoration: 'none', fontWeight: 500, fontSize: 14, border: '1px solid #d1d5db' };
const linkBtn: React.CSSProperties = { color: '#3b82f6', textDecoration: 'none', fontSize: 13, fontWeight: 500 };
const sectionHeader: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 };
const tableStyle: React.CSSProperties = { width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, borderCollapse: 'separate', borderSpacing: 0, overflow: 'hidden' };
const trHead: React.CSSProperties = { background: '#f9fafb' };
const trBody: React.CSSProperties = { borderTop: '1px solid #f3f4f6' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '12px 14px', borderTop: '1px solid #f3f4f6', fontSize: 14 };
const codeStyle: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 };
const errorBox: React.CSSProperties = { marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
