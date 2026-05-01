import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { CloudAccount, IdleAuditEntry, idle } from '../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function IdleAuditPage() {
  const router = useRouter();
  const { apiUrl } = useApiUrl();
  const [entries, setEntries] = useState<IdleAuditEntry[]>([]);
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
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
      const accountId = accountFilter ? Number(accountFilter) : undefined;
      const [audit, accs] = await Promise.all([
        idle.listAudit(apiUrl, { account_id: accountId, limit: 500 }),
        idle.listAccounts(apiUrl),
      ]);
      setEntries(audit.entries || []);
      setAccounts(accs.accounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, accountFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter((e) => {
    if (actionFilter && !e.action.includes(actionFilter)) return false;
    return true;
  });

  const uniqueActions = Array.from(new Set(entries.map((e) => e.action))).sort();

  return (
    <DevOpsLayout>
      <Head><title>Idle resources audit log</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <Link href="/idle-resources" style={{ color: '#6b7280', fontSize: 13 }}>← Back to overview</Link>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: '8px 0 4px' }}>Audit log</h1>
        <p style={{ color: '#6b7280', margin: '0 0 16px 0' }}>
          Every account creation, scan trigger, schedule run, exception change and AI rerank is recorded here.
        </p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <select style={inputStyle} value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select style={inputStyle} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All actions</option>
            {uniqueActions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button style={btnSecondary} onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <section style={card}>
          {filtered.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No audit entries.</p>
          ) : (
            <table style={tableStyle}>
              <thead><tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>Account</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Scan</th>
                <th style={thStyle}>Details</th>
              </tr></thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleString()}</td>
                    <td style={tdStyle}>{e.actor_username || (e.actor_id ? `user#${e.actor_id}` : 'system')}</td>
                    <td style={tdStyle}>{e.account_name || (e.account_id ? `account#${e.account_id}` : '—')}</td>
                    <td style={tdStyle}><code style={code}>{e.action}</code></td>
                    <td style={tdStyle}>
                      {e.scan_id ? <Link href={`/idle-resources/scans/${e.scan_id}`} style={{ color: '#3b82f6' }}>#{e.scan_id}</Link> : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12, color: '#374151', fontFamily: 'monospace', maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.details && Object.keys(e.details).length > 0 ? JSON.stringify(e.details) : ''}
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

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 };
const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, minWidth: 180 };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, background: '#fff', color: '#111827', fontWeight: 500, fontSize: 13, border: '1px solid #d1d5db', cursor: 'pointer' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 14 };
const code: React.CSSProperties = { background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' };
const errorBox: React.CSSProperties = { marginBottom: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
