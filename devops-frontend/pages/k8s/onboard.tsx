import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import K8sWorkspaceShell from '../../components/K8sWorkspaceShell';
import { useApiUrl } from '../../context/ApiUrlContext';
import {
  authModeCredentialLabel,
  authModeCredentialPlaceholder,
  authModeRequiresCredential,
  buildK8sHref,
  fetchK8sConnections,
  formatDateTime,
  K8sConnectionPayload,
  K8sOnboardingData,
  readQueryString,
  saveK8sConnection,
} from '../../lib/k8sWorkspace';

function createEmptyForm(): K8sConnectionPayload {
  return {
    project_id: 0,
    cloud: '',
    cluster_name: '',
    cluster_endpoint: '',
    environment: '',
    auth_mode: 'service_account',
    auth_credential: '',
  };
}

export default function DevOpsK8sOnboardPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [data, setData] = useState<K8sOnboardingData>({ projects: [], connections: [], auth_modes: [] });
  const [form, setForm] = useState<K8sConnectionPayload>(createEmptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

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
        setData({ projects: [], connections: [], auth_modes: [] });
        setError(err instanceof Error ? err.message : 'Failed to load cluster onboarding');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [apiUrl, refreshKey, router.isReady]);

  useEffect(() => {
    if (!data.projects.length) return;
    const requestedProjectId = readQueryString(router.query.project_id);
    const requestedEnvironment = readQueryString(router.query.environment);
    const selectedProject =
      data.projects.find((project) => String(project.id) === requestedProjectId) || data.projects[0];
    const nextAuthMode = data.auth_modes[0] || 'service_account';

    setForm((current) => {
      if (current.project_id) return current;
      return {
        ...current,
        project_id: selectedProject?.id || 0,
        cloud: selectedProject?.clouds[0] || '',
        environment:
          (requestedEnvironment &&
          selectedProject?.environments.includes(requestedEnvironment)
            ? requestedEnvironment
            : selectedProject?.environments[0]) || '',
        auth_mode: nextAuthMode,
      };
    });
  }, [data.auth_modes, data.projects, router.query.environment, router.query.project_id]);

  const selectedProject = useMemo(
    () => data.projects.find((project) => project.id === form.project_id) || null,
    [data.projects, form.project_id],
  );

  useEffect(() => {
    if (!selectedProject) return;
    setForm((current) => ({
      ...current,
      cloud: selectedProject.clouds.includes(current.cloud) ? current.cloud : selectedProject.clouds[0] || '',
      environment: selectedProject.environments.includes(current.environment)
        ? current.environment
        : selectedProject.environments[0] || '',
    }));
  }, [selectedProject]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const message = await saveK8sConnection(apiUrl, form);
      setSuccess(message);
      setForm((current) => ({
        ...current,
        cluster_name: '',
        cluster_endpoint: '',
        auth_credential: '',
      }));
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cluster onboarding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Onboard K8s Cluster - DevOps</title>
      </Head>
      <DevOpsLayout>
        <K8sWorkspaceShell
          title="Onboard K8s Cluster"
          subtitle="Register a cluster once, then let the workspace pages reuse that mapping across workloads, services, configmaps, and storage."
          queryState={{
            project_id: form.project_id ? String(form.project_id) : '',
            environment: form.environment,
          }}
          actions={
            <Link href={buildK8sHref('/k8s', { project_id: form.project_id || undefined, environment: form.environment })} className="btn btn-secondary">
              Back to clusters
            </Link>
          }
        >
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="alert alert-success" role="status">
              {success}
            </div>
          ) : null}

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Cluster setup</span>
                <h2 className="portal-surface__title">Register cluster access</h2>
                <p className="portal-surface__subtitle">
                  Map a project to its Kubernetes cluster so the DevOps workspace can show a scoped, cluster-aware view.
                </p>
              </div>
            </div>

            <form className="portal-form-grid" onSubmit={handleSubmit}>
              <label className="label">
                Project
                <select
                  className="input"
                  value={form.project_id ? String(form.project_id) : ''}
                  onChange={(event) => setForm((current) => ({ ...current, project_id: Number(event.target.value) || 0 }))}
                  required
                >
                  <option value="">Select project</option>
                  {data.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.code})
                    </option>
                  ))}
                </select>
              </label>

              <label className="label">
                Cloud
                <select
                  className="input"
                  value={form.cloud}
                  onChange={(event) => setForm((current) => ({ ...current, cloud: event.target.value }))}
                  required
                >
                  {(selectedProject?.clouds || []).map((cloud) => (
                    <option key={cloud} value={cloud}>
                      {cloud.toUpperCase()}
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
                Cluster endpoint
                <input
                  className="input"
                  value={form.cluster_endpoint}
                  onChange={(event) => setForm((current) => ({ ...current, cluster_endpoint: event.target.value }))}
                  placeholder="https://cluster.example.com"
                  required
                />
              </label>

              <label className="label">
                Auth mode
                <select
                  className="input"
                  value={form.auth_mode}
                  onChange={(event) => setForm((current) => ({ ...current, auth_mode: event.target.value }))}
                  required
                >
                  {data.auth_modes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>

              {authModeRequiresCredential(form.auth_mode) ? (
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
                      value={form.auth_credential}
                      onChange={(event) => setForm((current) => ({ ...current, auth_credential: event.target.value }))}
                      placeholder={authModeCredentialPlaceholder(form.auth_mode)}
                      required
                    />
                  )}
                </label>
              ) : (
                <div className="portal-note portal-form-grid__span-2">
                  In-cluster mode does not need a pasted credential. The backend is expected to run with cluster-native access.
                </div>
              )}

              <div className="portal-form-actions portal-form-grid__span-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save cluster'}
                </button>
              </div>
            </form>
          </section>

          <section className="portal-surface portal-surface--table">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Registered clusters</span>
                <h2 className="portal-surface__title">Current K8s cluster mappings</h2>
                <p className="portal-surface__subtitle">
                  Review the cluster mappings already available to the workspace and jump into a cluster view directly.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="portal-empty">
                <p>Loading registered clusters...</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="templates-table k8s-data-table">
                  <thead>
                    <tr>
                      <th>K8s cluster</th>
                      <th>Project</th>
                      <th>Cloud</th>
                      <th>Environment</th>
                      <th>Auth mode</th>
                      <th>Credential</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.connections.map((connection) => (
                      <tr key={connection.id}>
                        <td>
                          <Link
                            href={buildK8sHref('/k8s/workloads', {
                              project_id: connection.project_id,
                              cluster_name: connection.cluster_name,
                              environment: connection.environment,
                            })}
                            className="k8s-link-cell"
                          >
                            <span className="k8s-link-cell__title">{connection.cluster_name}</span>
                            <span className="k8s-link-cell__meta">{connection.cluster_endpoint}</span>
                          </Link>
                        </td>
                        <td>
                          <div className="k8s-link-cell__title">{connection.project_name}</div>
                          <div className="k8s-link-cell__meta">{connection.project_code}</div>
                        </td>
                        <td>{connection.cloud.toUpperCase()}</td>
                        <td><span className="portal-pill">{connection.environment.toUpperCase()}</span></td>
                        <td>{connection.auth_mode}</td>
                        <td>{connection.has_auth_credential ? 'Configured' : 'Missing'}</td>
                        <td>{formatDateTime(connection.updated_at)}</td>
                      </tr>
                    ))}
                    {data.connections.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="portal-empty">
                            <p>No K8s clusters are registered yet.</p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </K8sWorkspaceShell>
      </DevOpsLayout>
    </>
  );
}
