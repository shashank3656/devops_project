import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CloudAccount, IdleException, IdleOptions, IdleScan, IdleSchedule, cloudLabels, idle } from '../../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function AccountDetail() {
  const router = useRouter();
  const { id } = router.query;
  const accountId = Number(id);
  const { apiUrl } = useApiUrl();
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [scans, setScans] = useState<IdleScan[]>([]);
  const [opts, setOpts] = useState<IdleOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // scan form
  const [regions, setRegions] = useState('');
  const [scopeSel, setScopeSel] = useState<string[]>([]);
  const [scanProvider, setScanProvider] = useState('');
  const [scanModel, setScanModel] = useState('');

  // schedules + exceptions
  const [schedules, setSchedules] = useState<IdleSchedule[]>([]);
  const [exceptions, setExceptions] = useState<IdleException[]>([]);
  const [newSchedule, setNewSchedule] = useState({ name: 'Daily idle scan', cadence: 'daily' as 'hourly' | 'daily' | 'weekly', hour_utc: 4, regions: '', scope: '' });
  const [newException, setNewException] = useState({ resource_id: '', reason: '', expires_at: '' });

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(DEVOPS_TOKEN_KEY)) {
      router.replace('/login');
    }
  }, [router]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError('');
    try {
      const [a, s, o, sched, exc] = await Promise.all([
        idle.getAccount(apiUrl, accountId),
        idle.listScans(apiUrl, accountId),
        idle.options(apiUrl),
        idle.listSchedules(apiUrl, accountId).catch(() => ({ schedules: [] })),
        idle.listExceptions(apiUrl, accountId).catch(() => ({ exceptions: [] })),
      ]);
      setAccount(a.account);
      setScans(s.scans);
      setOpts(o);
      setSchedules(sched.schedules || []);
      setExceptions(exc.exceptions || []);
      setRegions(a.account.default_regions.join(', '));
      setScopeSel(o.scan_scopes[a.account.cloud] || []);
      setScanProvider(a.account.ai_provider || o.ai_providers[0] || 'none');
      setScanModel(a.account.ai_model || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, accountId]);

  useEffect(() => { load(); }, [load]);

  const onTest = async () => {
    setBusy('test');
    setError('');
    try {
      const res = await idle.testAccount(apiUrl, accountId);
      alert(`Connection ok: ${res.info}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'test failed');
    } finally {
      setBusy('');
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this account and all its scans? Audit log entries are kept.')) return;
    setBusy('delete');
    try {
      await idle.deleteAccount(apiUrl, accountId);
      router.replace('/idle-resources');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
      setBusy('');
    }
  };

  const onAddSchedule = async () => {
    if (!accountId) return;
    setBusy('schedule');
    try {
      await idle.createSchedule(apiUrl, accountId, {
        name: newSchedule.name,
        cadence: newSchedule.cadence,
        hour_utc: Number(newSchedule.hour_utc) || 0,
        regions: newSchedule.regions.split(',').map((r) => r.trim()).filter(Boolean),
        scope: newSchedule.scope.split(',').map((r) => r.trim()).filter(Boolean),
        enabled: true,
      });
      setNewSchedule({ name: 'Daily idle scan', cadence: 'daily', hour_utc: 4, regions: '', scope: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'schedule failed');
    } finally {
      setBusy('');
    }
  };

  const onToggleSchedule = async (s: IdleSchedule) => {
    setBusy('schedule');
    try {
      await idle.updateSchedule(apiUrl, accountId, s.id, { ...s, enabled: !s.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'update failed');
    } finally {
      setBusy('');
    }
  };

  const onDeleteSchedule = async (id: number) => {
    if (!confirm('Delete this schedule?')) return;
    setBusy('schedule');
    try {
      await idle.deleteSchedule(apiUrl, accountId, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy('');
    }
  };

  const onAddException = async () => {
    if (!accountId || !newException.resource_id.trim()) return;
    setBusy('exception');
    try {
      await idle.createException(apiUrl, accountId, {
        resource_id: newException.resource_id.trim(),
        reason: newException.reason.trim(),
        expires_at: newException.expires_at ? new Date(newException.expires_at).toISOString() : undefined,
      });
      setNewException({ resource_id: '', reason: '', expires_at: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'exception failed');
    } finally {
      setBusy('');
    }
  };

  const onDeleteException = async (id: number) => {
    if (!confirm('Remove this exception? Future scans will surface the resource again.')) return;
    setBusy('exception');
    try {
      await idle.deleteException(apiUrl, accountId, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'delete failed');
    } finally {
      setBusy('');
    }
  };

  const onStartScan = async () => {
    setBusy('scan');
    setError('');
    try {
      const res = await idle.createScan(apiUrl, {
        account_id: accountId,
        regions: regions.split(',').map((r) => r.trim()).filter(Boolean),
        scope: scopeSel,
        ai_provider: scanProvider,
        ai_model: scanModel,
      });
      router.push(`/idle-resources/scans/${res.scan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'scan failed');
      setBusy('');
    }
  };

  if (loading || !account) {
    return <DevOpsLayout><div style={{ padding: 32 }}>Loading…</div></DevOpsLayout>;
  }

  return (
    <DevOpsLayout>
      <Head><title>{account.name} – Idle Resources</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <Link href="/idle-resources" style={{ color: '#6b7280', fontSize: 13 }}>← Back to all accounts</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 8 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>{account.name}</h1>
            <div style={{ color: '#6b7280', marginTop: 4 }}>
              {cloudLabels[account.cloud]} · {account.auth_method} · {account.default_regions.join(', ') || 'no regions'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnSecondary} onClick={onTest} disabled={busy !== ''}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
            <button style={btnDanger} onClick={onDelete} disabled={busy !== ''}>Delete</button>
          </div>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <section style={card}>
          <h2 style={cardTitle}>Run a scan</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Regions">
              <input style={inputStyle} value={regions} onChange={(e) => setRegions(e.target.value)} />
            </Field>
            <Field label="Scope">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(opts?.scan_scopes[account.cloud] || []).map((svc) => {
                  const checked = scopeSel.includes(svc);
                  return (
                    <label key={svc} style={{ ...chipStyle, background: checked ? '#111827' : '#fff', color: checked ? '#fff' : '#111827', borderColor: checked ? '#111827' : '#d1d5db' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setScopeSel(checked ? scopeSel.filter((s) => s !== svc) : [...scopeSel, svc])}
                        style={{ display: 'none' }}
                      />
                      {svc}
                    </label>
                  );
                })}
              </div>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="AI provider">
                <select style={inputStyle} value={scanProvider} onChange={(e) => setScanProvider(e.target.value)}>
                  {opts?.ai_providers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="AI model (optional)">
                <input style={inputStyle} value={scanModel} onChange={(e) => setScanModel(e.target.value)} />
              </Field>
            </div>
            <div>
              <button style={btnPrimary} onClick={onStartScan} disabled={busy !== ''}>
                {busy === 'scan' ? 'Starting…' : 'Start scan'}
              </button>
            </div>
          </div>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Schedules</h2>
          <p style={{ color: '#6b7280', margin: '0 0 14px 0', fontSize: 13 }}>
            Trigger automatic scans on a cadence. The runner ticks every 5 minutes, so daily/weekly cron will fire close to the chosen UTC hour.
          </p>
          {schedules.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No schedules yet.</p>
          ) : (
            <table style={tableStyle}>
              <thead><tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Name</th><th style={thStyle}>Cadence</th><th style={thStyle}>Last run</th><th style={thStyle}>Status</th><th style={thStyle}></th>
              </tr></thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{s.name}</td>
                    <td style={tdStyle}>{s.cadence === 'hourly' ? 'Hourly' : s.cadence === 'weekly' ? `Mon @ ${s.hour_utc}:00 UTC` : `Daily @ ${s.hour_utc}:00 UTC`}</td>
                    <td style={tdStyle}>{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : '—'}</td>
                    <td style={tdStyle}>{s.enabled ? <span style={{ color: '#059669' }}>● enabled</span> : <span style={{ color: '#9ca3af' }}>○ paused</span>} {s.last_run_status ? `· ${s.last_run_status}` : ''}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button style={btnSecondary} onClick={() => onToggleSchedule(s)} disabled={busy !== ''}>{s.enabled ? 'Pause' : 'Enable'}</button>
                      <button style={{ ...btnDanger, marginLeft: 8 }} onClick={() => onDeleteSchedule(s.id)} disabled={busy !== ''}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 14, padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
              <Field label="Name">
                <input style={inputStyle} value={newSchedule.name} onChange={(e) => setNewSchedule({ ...newSchedule, name: e.target.value })} />
              </Field>
              <Field label="Cadence">
                <select style={inputStyle} value={newSchedule.cadence} onChange={(e) => setNewSchedule({ ...newSchedule, cadence: e.target.value as 'hourly' | 'daily' | 'weekly' })}>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly (Mon)</option>
                </select>
              </Field>
              <Field label="UTC hour">
                <input style={inputStyle} type="number" min={0} max={23} value={newSchedule.hour_utc} onChange={(e) => setNewSchedule({ ...newSchedule, hour_utc: Number(e.target.value) })} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <Field label="Regions (optional, comma-sep)">
                <input style={inputStyle} placeholder={account.default_regions.join(', ')} value={newSchedule.regions} onChange={(e) => setNewSchedule({ ...newSchedule, regions: e.target.value })} />
              </Field>
              <Field label="Scope (optional, comma-sep)">
                <input style={inputStyle} placeholder={(opts?.scan_scopes[account.cloud] || []).join(', ')} value={newSchedule.scope} onChange={(e) => setNewSchedule({ ...newSchedule, scope: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={btnPrimary} onClick={onAddSchedule} disabled={busy !== ''}>{busy === 'schedule' ? 'Saving…' : 'Add schedule'}</button>
            </div>
          </div>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Exceptions</h2>
          <p style={{ color: '#6b7280', margin: '0 0 14px 0', fontSize: 13 }}>
            Whitelisted resource IDs are skipped on future scans. Useful for resources that are intentionally idle (e.g. cold-standby DR).
          </p>
          {exceptions.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No exceptions configured.</p>
          ) : (
            <table style={tableStyle}>
              <thead><tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Resource ID</th><th style={thStyle}>Reason</th><th style={thStyle}>Expires</th><th style={thStyle}></th>
              </tr></thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{e.resource_id}</td>
                    <td style={tdStyle}>{e.reason || '—'}</td>
                    <td style={tdStyle}>{e.expires_at ? new Date(e.expires_at).toLocaleDateString() : 'never'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button style={btnDanger} onClick={() => onDeleteException(e.id)} disabled={busy !== ''}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 14, padding: 14, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 10 }}>
              <Field label="Resource ID">
                <input style={inputStyle} placeholder="e.g. arn:aws:ec2:us-east-1:…/i-1234" value={newException.resource_id} onChange={(e) => setNewException({ ...newException, resource_id: e.target.value })} />
              </Field>
              <Field label="Reason">
                <input style={inputStyle} placeholder="DR standby" value={newException.reason} onChange={(e) => setNewException({ ...newException, reason: e.target.value })} />
              </Field>
              <Field label="Expires (optional)">
                <input style={inputStyle} type="date" value={newException.expires_at} onChange={(e) => setNewException({ ...newException, expires_at: e.target.value })} />
              </Field>
            </div>
            <div style={{ marginTop: 10 }}>
              <button style={btnPrimary} onClick={onAddException} disabled={busy !== '' || !newException.resource_id.trim()}>{busy === 'exception' ? 'Saving…' : 'Add exception'}</button>
            </div>
          </div>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Scan history</h2>
          {scans.length === 0 ? (
            <p style={{ color: '#6b7280', margin: 0 }}>No scans yet.</p>
          ) : (
            <table style={tableStyle}>
              <thead><tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>#</th><th style={thStyle}>Status</th><th style={thStyle}>Regions</th><th style={thStyle}>Started</th><th style={thStyle}></th>
              </tr></thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{s.id}</td>
                    <td style={tdStyle}>{s.status}</td>
                    <td style={tdStyle}>{s.regions.join(', ')}</td>
                    <td style={tdStyle}>{s.started_at ? new Date(s.started_at).toLocaleString() : '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <Link href={`/idle-resources/scans/${s.id}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>View →</Link>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 24 };
const cardTitle: React.CSSProperties = { margin: '0 0 14px 0', fontSize: 16, fontWeight: 600 };
const btnPrimary: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, background: '#111827', color: '#fff', fontWeight: 500, fontSize: 14, border: 'none', cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, background: '#fff', color: '#111827', fontWeight: 500, fontSize: 13, border: '1px solid #d1d5db', cursor: 'pointer' };
const btnDanger: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, background: '#fff', color: '#dc2626', fontWeight: 500, fontSize: 13, border: '1px solid #fecaca', cursor: 'pointer' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' };
const chipStyle: React.CSSProperties = { padding: '6px 12px', borderRadius: 999, border: '1px solid #d1d5db', fontSize: 13, cursor: 'pointer' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0 };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '10px 14px', fontSize: 14 };
const errorBox: React.CSSProperties = { marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
