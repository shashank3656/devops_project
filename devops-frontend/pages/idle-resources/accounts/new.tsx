import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CloudKind, IdleOptions, cloudLabels, idle } from '../../../lib/idleResources';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function NewCloudAccount() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [opts, setOpts] = useState<IdleOptions | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // form state
  const [name, setName] = useState('');
  const [cloud, setCloud] = useState<CloudKind>('aws');
  const [authMethod, setAuthMethod] = useState('aws_keys');
  const [regions, setRegions] = useState('us-east-1');
  const [currency, setCurrency] = useState('USD');
  const [retentionDays, setRetentionDays] = useState('90');
  const [aiProvider, setAiProvider] = useState('none');
  const [aiModel, setAiModel] = useState('');

  // creds
  const [creds, setCreds] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(DEVOPS_TOKEN_KEY)) {
      router.replace('/login');
    }
    idle.options(apiUrl).then(setOpts).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [apiUrl, router]);

  // when cloud changes pick first auth method
  useEffect(() => {
    if (opts) {
      const first = opts.auth_methods[cloud][0];
      setAuthMethod(first);
      setCreds({});
    }
  }, [cloud, opts]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        name,
        cloud,
        default_regions: regions.split(',').map((r) => r.trim()).filter(Boolean),
        default_currency: currency,
        retention_days: retentionDays ? Number(retentionDays) : null,
        ai_provider: aiProvider,
        ai_model: aiModel,
        credentials: { auth_method: authMethod, ...creds },
      };
      const res = await idle.createAccount(apiUrl, payload);
      router.push(`/idle-resources/accounts/${res.account.id}?created=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>Connect Cloud Account – Idle Resources</title></Head>
      <div style={{ padding: '24px 32px', maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Connect a cloud account</h1>
        <p style={{ color: '#6b7280', marginTop: 4 }}>Pick the cloud and auth method, paste the credentials, save.</p>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={onSubmit} style={{ marginTop: 24, display: 'grid', gap: 18 }}>
          <Field label="Account name">
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required placeholder="prod-aws-101" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Cloud">
              <select style={inputStyle} value={cloud} onChange={(e) => setCloud(e.target.value as CloudKind)}>
                {opts?.clouds.map((c) => <option key={c} value={c}>{cloudLabels[c]}</option>)}
              </select>
            </Field>
            <Field label="Auth method">
              <select style={inputStyle} value={authMethod} onChange={(e) => setAuthMethod(e.target.value)}>
                {opts?.auth_methods[cloud]?.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Default regions" hint="Comma-separated. Used as the default scan scope.">
            <input style={inputStyle} value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="us-east-1, eu-west-1" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Currency">
              <input style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </Field>
            <Field label="Retention (days)" hint="Override the global default.">
              <input style={inputStyle} type="number" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} />
            </Field>
            <Field label="AI provider">
              <select style={inputStyle} value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}>
                {opts?.ai_providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          {aiProvider !== 'none' && (
            <Field label="AI model" hint="Optional override. Leave blank for the provider default.">
              <input style={inputStyle} value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o-mini, claude-3-5-haiku, gemini-1.5-flash, llama3.1" />
            </Field>
          )}

          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 18 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Credentials</h2>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>Encrypted with AES-256-GCM at rest. Only DevOps users can read or rotate them.</p>
            <CredentialFields cloud={cloud} authMethod={authMethod} creds={creds} setCreds={setCreds} />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={btnSecondary} onClick={() => router.back()}>Cancel</button>
            <button type="submit" style={btnPrimary} disabled={submitting}>
              {submitting ? 'Connecting…' : 'Connect account'}
            </button>
          </div>
        </form>
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

function CredentialFields({ cloud, authMethod, creds, setCreds }: { cloud: CloudKind; authMethod: string; creds: Record<string, string>; setCreds: (v: Record<string, string>) => void }) {
  const set = (k: string, v: string) => setCreds({ ...creds, [k]: v });

  if (cloud === 'aws') {
    if (authMethod === 'aws_keys') {
      return (
        <>
          <Field label="Access key ID"><input style={inputStyle} value={creds.aws_access_key_id || ''} onChange={(e) => set('aws_access_key_id', e.target.value)} required /></Field>
          <Field label="Secret access key"><input type="password" style={inputStyle} value={creds.aws_secret_access_key || ''} onChange={(e) => set('aws_secret_access_key', e.target.value)} required /></Field>
          <Field label="Session token (optional)"><input style={inputStyle} value={creds.aws_session_token || ''} onChange={(e) => set('aws_session_token', e.target.value)} /></Field>
        </>
      );
    }
    if (authMethod === 'aws_assume_role') {
      return (
        <>
          <Field label="Role ARN"><input style={inputStyle} value={creds.aws_role_arn || ''} onChange={(e) => set('aws_role_arn', e.target.value)} required placeholder="arn:aws:iam::123456789012:role/IdleScannerRole" /></Field>
          <Field label="External ID (optional)"><input style={inputStyle} value={creds.aws_external_id || ''} onChange={(e) => set('aws_external_id', e.target.value)} /></Field>
        </>
      );
    }
    if (authMethod === 'aws_profile') {
      return <Field label="AWS profile name"><input style={inputStyle} value={creds.aws_profile || ''} onChange={(e) => set('aws_profile', e.target.value)} required /></Field>;
    }
    return <p style={{ color: '#6b7280', fontSize: 13 }}>Uses the host instance role attached to this server. No credentials needed.</p>;
  }

  if (cloud === 'azure') {
    return (
      <>
        <Field label="Subscription ID"><input style={inputStyle} value={creds.azure_subscription_id || ''} onChange={(e) => set('azure_subscription_id', e.target.value)} required /></Field>
        {(authMethod === 'azure_sp_secret' || authMethod === 'azure_sp_cert') && (
          <>
            <Field label="Tenant ID"><input style={inputStyle} value={creds.azure_tenant_id || ''} onChange={(e) => set('azure_tenant_id', e.target.value)} required /></Field>
            <Field label="Client ID"><input style={inputStyle} value={creds.azure_client_id || ''} onChange={(e) => set('azure_client_id', e.target.value)} required /></Field>
          </>
        )}
        {authMethod === 'azure_sp_secret' && (
          <Field label="Client secret"><input type="password" style={inputStyle} value={creds.azure_client_secret || ''} onChange={(e) => set('azure_client_secret', e.target.value)} required /></Field>
        )}
        {authMethod === 'azure_sp_cert' && (
          <Field label="Client certificate (PEM)"><textarea style={{ ...inputStyle, fontFamily: 'monospace' }} rows={5} value={creds.azure_client_cert_pem || ''} onChange={(e) => set('azure_client_cert_pem', e.target.value)} required /></Field>
        )}
        {(authMethod === 'azure_managed_identity' || authMethod === 'azure_oidc_wif') && (
          <p style={{ color: '#6b7280', fontSize: 13 }}>Host identity provides authentication. Subscription ID above is enough.</p>
        )}
      </>
    );
  }

  return (
    <>
      <Field label="Project ID"><input style={inputStyle} value={creds.gcp_project_id || ''} onChange={(e) => set('gcp_project_id', e.target.value)} required /></Field>
      {authMethod === 'gcp_sa_json' && (
        <Field label="Service account JSON" hint="Paste the entire JSON body."><textarea style={{ ...inputStyle, fontFamily: 'monospace' }} rows={6} value={creds.gcp_service_account_json || ''} onChange={(e) => set('gcp_service_account_json', e.target.value)} required /></Field>
      )}
      {authMethod === 'gcp_wif' && (
        <Field label="Workload Identity Federation config JSON"><textarea style={{ ...inputStyle, fontFamily: 'monospace' }} rows={6} value={creds.gcp_wif_config_json || ''} onChange={(e) => set('gcp_wif_config_json', e.target.value)} required /></Field>
      )}
      {authMethod === 'gcp_metadata' && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Uses the metadata server attached to this host.</p>
      )}
    </>
  );
}

const btnPrimary: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, background: '#111827', color: '#fff', fontWeight: 500, fontSize: 14, border: 'none', cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, background: '#fff', color: '#111827', fontWeight: 500, fontSize: 14, border: '1px solid #d1d5db', cursor: 'pointer' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, fontFamily: 'inherit' };
const errorBox: React.CSSProperties = { marginTop: 16, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b' };
