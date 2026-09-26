import { normalizeCloudProvider, providerLabel } from '../lib/cloudProviders';
import { k8sAuthModeLabel, k8sClusterSetupSteps } from '../lib/k8sConnectionOptions';

export default function K8sClusterSetupGuide({ cloud, authMode }: { cloud: string; authMode: string }) {
  const provider = normalizeCloudProvider(cloud);
  const steps = k8sClusterSetupSteps(cloud, authMode);
  return (
    <aside className="portal-surface cloud-trust-guide" aria-label={`${providerLabel(provider)} cluster setup`}>
      <span className="portal-surface__eyebrow">Secure connect</span>
      <h2 className="portal-surface__title">
        {providerLabel(provider)} · {k8sAuthModeLabel(authMode)}
      </h2>
      <p className="portal-surface__subtitle">
        Credentials never appear in list APIs. Tokens and kubeconfigs are encrypted at rest; prefer IAM, workload identity, or server secret references.
      </p>
      <ol className="cloud-trust-guide__steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="cloud-trust-guide__step-num">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p className="ig-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
