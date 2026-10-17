import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import K8sClusterSetupGuide from '../../../components/K8sClusterSetupGuide';
import K8sWorkspaceShell from '../../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { CLOUD_PROVIDER_SEGMENT, normalizeCloudProvider } from '../../../lib/cloudProviders';
import {
  buildK8sTrustCredentialJson,
  emptyK8sTrustFields,
  k8sAuthModeLabel,
  k8sAuthModeRequiresCredential,
  k8sAuthModesForCloud,
  k8sAuthModeUsesSecretRef,
  k8sAuthModeUsesTrustJson,
  type K8sTrustFields,
} from '../../../lib/k8sConnectionOptions';
import {
  authModeCredentialLabel,
  authModeCredentialPlaceholder,
  buildK8sHref,
  fetchK8sConnections,
  K8sConnectionPayload,
  K8sOnboardingData,
  readQueryString,
  saveK8sConnection,
  testK8sConnection,
} from '../../../lib/k8sWorkspace';
import { SegmentedControl } from '@infragate/ui';

function createEmptyForm(): K8sConnectionPayload {
  return {
    project_id: 0,
    cloud: 'aws',
    cluster_name: '',
    cluster_endpoint: '',
    environment: '',
    auth_mode: 'eks_iam',
    auth_credential: '',
  };
}

function payloadFromForm(form: K8sConnectionPayload, trust: K8sTrustFields): K8sConnectionPayload {
  const body = { ...form };
  if (k8sAuthModeUsesTrustJson(form.auth_mode)) {
    body.auth_credential = buildK8sTrustCredentialJson(form.cloud, form.auth_mode, trust);
  }
  return body;
}

export default function DevOpsK8sOnboardFormPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sOnboardingData>({
    projects: [],
    connections: [],
    auth_modes: [],
    auth_modes_by_cloud: {},
  });
  const [form, setForm] = useState<K8sConnectionPayload>(createEmptyForm());
  const [trust, setTrust] = useState<K8sTrustFields>(emptyK8sTrustFields());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!router.isReady) return;
    let active = true;
    setLoading(true);
    setError('');

    fetchK8sConnections(apiUrl)
      .then((payload) => {
        if (!active) return;
        setData(payload);
      })
      .catch((err) => {
        if (!active) return;
        setData({ projects: [], connections: [], auth_modes: [], auth_modes_by_cloud: {} });
        setError(err instanceof Error ? err.message : 'Failed to load cluster onboarding');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, router.isReady]);

  const writableProjects = useMemo(
    () => data.projects.filter((project) => project.k8s_access === 'write'),
    [data.projects],
  );

  useEffect(() => {
    if (!writableProjects.length) return;
    const requestedProjectId = readQueryString(router.query.project_id);
    const requestedEnvironment = readQueryString(router.query.environment);
    const selectedProject =
      writableProjects.find((project) => String(project.id) === requestedProjectId) || writableProjects[0];
    const cloud = normalizeCloudProvider(selectedProject?.clouds[0] || 'aws');
    const modes = k8sAuthModesForCloud(cloud, data.auth_modes_by_cloud);

    setForm((current) => {
      if (current.project_id) return current;
      return {
        ...current,
        project_id: selectedProject?.id || 0,
        cloud,
        environment:
          (requestedEnvironment && selectedProject?.environments.includes(requestedEnvironment)
            ? requestedEnvironment
            : selectedProject?.environments[0]) || '',
        auth_mode: modes[0] || 'secret_ref',
      };
    });
  }, [data.auth_modes_by_cloud, router.query.environment, router.query.project_id, writableProjects]);

  const selectedProject = useMemo(
    () => data.projects.find((project) => project.id === form.project_id) || null,
    [data.projects, form.project_id],
  );

  const authModes = useMemo(
    () => k8sAuthModesForCloud(form.cloud, data.auth_modes_by_cloud),
    [data.auth_modes_by_cloud, form.cloud],
  );

  useEffect(() => {
    if (!selectedProject) return;
    setForm((current) => ({
      ...current,
      cloud: selectedProject.clouds.includes(current.cloud)
        ? current.cloud
        : normalizeCloudProvider(selectedProject.clouds[0] || 'aws'),
      environment: selectedProject.environments.includes(current.environment)
        ? current.environment
        : selectedProject.environments[0] || '',
    }));
  }, [selectedProject]);

  useEffect(() => {
    if (!authModes.includes(form.auth_mode)) {
      setForm((current) => ({ ...current, auth_mode: authModes[0] || 'secret_ref', auth_credential: '' }));
      setTrust(emptyK8sTrustFields());
    }
  }, [authModes, form.auth_mode]);

  const catalogHref = buildK8sHref('/k8s/onboard', {
    project_id: form.project_id || undefined,
    environment: form.environment,
  });

  const onCloudChange = (next: string) => {
    const cloud = normalizeCloudProvider(next);
    const modes = k8sAuthModesForCloud(cloud, data.auth_modes_by_cloud);
    setForm((current) => ({
      ...current,
      cloud,
      auth_mode: modes[0] || 'secret_ref',
      auth_credential: '',
    }));
    setTrust(emptyK8sTrustFields());
    setTestOk('');
  };

  const runTest = async () => {
    setTesting(true);
    setError('');
    setTestOk('');
    try {
      const message = await testK8sConnection(apiUrl, payloadFromForm(form, trust));
      setTestOk(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await saveK8sConnection(apiUrl, payloadFromForm(form, trust));
      await router.push(catalogHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cluster onboarding');
    } finally {
      setSaving(false);
    }
  };

  const showPastedSecret =
    k8sAuthModeRequiresCredential(form.auth_mode) &&
    !k8sAuthModeUsesTrustJson(form.auth_mode) &&
    !k8sAuthModeUsesSecretRef(form.auth_mode);

  return (
    <>
      <Head>
        <title>Onboard K8s cluster - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Onboard cluster"
          subtitle="Register cluster access securely. Prefer cloud IAM or workload identity; never expose secrets in list APIs."
          queryState={{
            project_id: form.project_id ? String(form.project_id) : '',
            environment: form.environment,
          }}
          actions={
            <Link href={catalogHref} className="btn btn-secondary">
              Back to connections
            </Link>
          }
        >
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          {!loading && writableProjects.length === 0 ? (
            <div className="alert alert-error" role="alert">
              Write access is not granted for a project, so this cluster cannot be onboarded.
            </div>
          ) : null}
          {testOk ? (
            <div className="alert alert-success" role="status">
              {testOk}
            </div>
          ) : null}

          <K8sClusterSetupGuide cloud={form.cloud} authMode={form.auth_mode} />

          <p className="portal-note" style={{ marginTop: 12 }}>
            Cloud inventory trust is separate from cluster API access. If this cluster runs in an onboarded{' '}
            <Link href="/cloud-accounts">cloud account</Link>, complete that trust first, then register the EKS/AKS/GKE
            endpoint here.
          </p>

          <section className="portal-surface" style={{ marginTop: 16 }}>
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cluster setup</span>
                <h2 className="portal-surface__title">Register cluster access</h2>
                <p className="portal-surface__subtitle">
                  Pick cloud and connection type, then test reachability before saving to the connection inventory.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="portal-empty">
                <p>Loading projects...</p>
              </div>
            ) : (
              <form className="portal-form-grid" onSubmit={(e) => void handleSubmit(e)}>
                <div className="label portal-form-grid__span-2">
                  <span>Cloud</span>
                  <SegmentedControl
                    label="Cloud"
                    name="k8s-cloud"
                    options={CLOUD_PROVIDER_SEGMENT.filter((opt) =>
                      (selectedProject?.clouds || ['aws', 'azure', 'gcp']).includes(opt.value),
                    )}
                    value={normalizeCloudProvider(form.cloud)}
                    onChange={onCloudChange}
                  />
                </div>

                <label className="label">
                  Project
                  <select
                    className="input"
                    value={form.project_id ? String(form.project_id) : ''}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, project_id: Number(event.target.value) || 0 }))
                    }
                    required
                  >
                    <option value="">Select project</option>
                    {writableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.code})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="label">
                  Environment
                  <select
                    className="input"
                    value={form.environment}
                    onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                    required
                  >
                    {(selectedProject?.environments || []).map((item) => (
                      <option key={item} value={item}>
                        {item.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="label portal-form-grid__span-2">
                  K8s cluster name
                  <input
                    className="input"
                    value={form.cluster_name}
                    onChange={(event) => setForm((current) => ({ ...current, cluster_name: event.target.value }))}
                    placeholder="payments-eks-prod"
                    required
                  />
                </label>

                <label className="label portal-form-grid__span-2">
                  Cluster endpoint (HTTPS)
                  <input
                    className="input"
                    type="url"
                    value={form.cluster_endpoint}
                    onChange={(event) => setForm((current) => ({ ...current, cluster_endpoint: event.target.value }))}
                    placeholder="https://XXXX.gr7.us-west-2.eks.amazonaws.com"
                    required
                  />
                </label>

                <label className="label portal-form-grid__span-2">
                  Connection type
                  <select
                    className="input"
                    value={form.auth_mode}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, auth_mode: event.target.value, auth_credential: '' }));
                      setTrust(emptyK8sTrustFields());
                      setTestOk('');
                    }}
                    required
                  >
                    {authModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {k8sAuthModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </label>

                {k8sAuthModeUsesSecretRef(form.auth_mode) ? (
                  <label className="label portal-form-grid__span-2">
                    Server secret reference
                    <input
                      className="input"
                      value={form.auth_credential}
                      onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                      placeholder="prod-eks-kubeconfig"
                      required
                    />
                    <span className="ig-muted">
                      Configure on API host: K8S_SECRET_REF_PROD_EKS_KUBECONFIG or K8S_SECRET_REFS JSON map.
                    </span>
                  </label>
                ) : null}

                {form.auth_mode === 'eks_iam' ? (
                  <>
                    <label className="label portal-form-grid__span-2">
                      IAM role ARN
                      <input
                        className="input"
                        value={trust.role_arn}
                        onChange={(event) => setTrust((t) => ({ ...t, role_arn: event.target.value }))}
                        placeholder="arn:aws:iam::111122223333:role/OpsTrellisEKSAccess"
                        required
                      />
                    </label>
                    <label className="label">
                      External ID
                      <input
                        className="input"
                        value={trust.external_id}
                        onChange={(event) => setTrust((t) => ({ ...t, external_id: event.target.value }))}
                        placeholder="unique-trust-id"
                      />
                    </label>
                    <label className="label">
                      Region
                      <input
                        className="input"
                        value={trust.region}
                        onChange={(event) => setTrust((t) => ({ ...t, region: event.target.value }))}
                        placeholder="us-west-2"
                      />
                    </label>
                  </>
                ) : null}

                {form.auth_mode === 'aks_workload_identity' ? (
                  <>
                    <label className="label">
                      Tenant ID
                      <input
                        className="input"
                        value={trust.tenant_id}
                        onChange={(event) => setTrust((t) => ({ ...t, tenant_id: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="label">
                      Subscription ID
                      <input
                        className="input"
                        value={trust.subscription_id}
                        onChange={(event) => setTrust((t) => ({ ...t, subscription_id: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="label">
                      Resource group
                      <input
                        className="input"
                        value={trust.resource_group}
                        onChange={(event) => setTrust((t) => ({ ...t, resource_group: event.target.value }))}
                      />
                    </label>
                    <label className="label">
                      Region
                      <input
                        className="input"
                        value={trust.region}
                        onChange={(event) => setTrust((t) => ({ ...t, region: event.target.value }))}
                        placeholder="eastus"
                      />
                    </label>
                  </>
                ) : null}

                {form.auth_mode === 'gke_workload_identity' ? (
                  <>
                    <label className="label">
                      GCP project ID
                      <input
                        className="input"
                        value={trust.project_id}
                        onChange={(event) => setTrust((t) => ({ ...t, project_id: event.target.value }))}
                        required
                      />
                    </label>
                    <label className="label portal-form-grid__span-2">
                      Service account email
                      <input
                        className="input"
                        value={trust.service_account_email}
                        onChange={(event) => setTrust((t) => ({ ...t, service_account_email: event.target.value }))}
                        placeholder="k8s-access@my-project.iam.gserviceaccount.com"
                        required
                      />
                    </label>
                    <label className="label">
                      Region
                      <input
                        className="input"
                        value={trust.region}
                        onChange={(event) => setTrust((t) => ({ ...t, region: event.target.value }))}
                        placeholder="us-central1"
                      />
                    </label>
                  </>
                ) : null}

                {showPastedSecret ? (
                  <label className="label portal-form-grid__span-2">
                    {authModeCredentialLabel(form.auth_mode)}
                    {form.auth_mode === 'kubeconfig' ? (
                      <textarea
                        className="input"
                        rows={6}
                        value={form.auth_credential}
                        onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                        placeholder={authModeCredentialPlaceholder(form.auth_mode)}
                        required
                      />
                    ) : (
                      <input
                        className="input"
                        type="password"
                        autoComplete="off"
                        value={form.auth_credential}
                        onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                        placeholder={authModeCredentialPlaceholder(form.auth_mode)}
                        required
                      />
                    )}
                    <span className="ig-muted">Encrypted at rest on the API server. Not returned in connection list APIs.</span>
                  </label>
                ) : null}

                {form.auth_mode === 'in_cluster' ? (
                  <div className="portal-note portal-form-grid__span-2">
                    In-cluster mode expects the OpsTrellis API to run with a service account inside this cluster. No credential is stored.
                  </div>
                ) : null}

                <div className="portal-form-actions portal-form-grid__span-2">
                  <Link href={catalogHref} className="btn btn-secondary">
                    Cancel
                  </Link>
                  <button type="button" className="btn btn-secondary" disabled={testing || saving} onClick={() => void runTest()}>
                    {testing ? 'Testing…' : 'Test connection'}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving || testing || writableProjects.length === 0}>
                    {saving ? 'Saving...' : 'Save cluster'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
