import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { IdleOptions, IdleSettings, idle } from '../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function IdleSettingsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [settings, setSettings] = useState<IdleSettings | null>(null);
  const [opts, setOpts] = useState<IdleOptions | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(DEVOPS_TOKEN_KEY)) {
      router.replace('/login');
    }
    Promise.all([idle.getSettings(apiUrl), idle.options(apiUrl)])
      .then(([s, o]) => { setSettings(s.settings); setOpts(o); })
      .catch((err) => setError(err instanceof Error ? err.message : 'load failed'));
  }, [apiUrl, router]);

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const res = await idle.updateSettings(apiUrl, settings);
      setSettings(res.settings);
      alert('Settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <DevOpsLayout><div style={{ padding: 32 }}>Loading…</div></DevOpsLayout>;
  }

  const update = (patch: Partial<IdleSettings>) => setSettings({ ...settings, ...patch });

  return (
    <DevOpsLayout>
      <Head><title>Idle Resources Settings</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 720, margin: '0 auto' }}>
        <Link href="/idle-resources" style={{ color: '#6b7280', fontSize: 13 }}>← Back</Link>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: '8px 0 4px 0' }}>Idle Resources Settings</h1>
        <p style={{ color: '#6b7280' }}>Global defaults. Per-account overrides win when set.</p>

        {error && <div style={errorBox}>{error}</div>}

        <section style={{ marginTop: 24, display: 'grid', gap: 16 }}>
          <Field label="Retention (days)" hint="Detailed resources + raw artifacts older than this are pruned. idle_scans summaries and idle_audit_log are kept forever.">
            <input style={inputStyle} type="number" min={1} value={settings.retention_days} onChange={(e) => update({ retention_days: Number(e.target.value) })} />
          </Field>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="checkbox" checked={settings.purge_raw_artifacts} onChange={(e) => update({ purge_raw_artifacts: e.target.checked })} />
            <span>Purge raw scan artifacts (Supabase <code>idle-scans/</code>) after retention</span>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="checkbox" checked={settings.purge_resources} onChange={(e) => update({ purge_resources: e.target.checked })} />
            <span>Also purge per-resource rows after retention (off keeps them forever)</span>
          </label>
          <Field label="Default AI provider">
            <select style={inputStyle} value={settings.default_ai_provider} onChange={(e) => update({ default_ai_provider: e.target.value })}>
              {opts?.ai_providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Default AI model" hint="Optional. Provider default is used when blank.">
            <input style={inputStyle} value={settings.default_ai_model} onChange={(e) => update({ default_ai_model: e.target.value })} />
          </Field>
          <div>
            <button style={btnPrimary} onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
          </div>
        </section>
      </div>
    </DevOpsLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

const btnPrimary: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, background: '#111827', color: '#fff', fontWeight: 500, fontSize: 14, border: 'none', cursor: 'pointer' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' };
const errorBox: React.CSSProperties = { marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
