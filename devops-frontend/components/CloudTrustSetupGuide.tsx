import { normalizeCloudProvider, providerLabel, providerTrustSetupSteps, type CloudProviderId } from '../lib/cloudProviders';

export default function CloudTrustSetupGuide({ provider }: { provider: string }) {
  const id = normalizeCloudProvider(provider) as CloudProviderId;
  const steps = providerTrustSetupSteps(id);
  return (
    <aside className="portal-surface cloud-trust-guide" aria-label={`${providerLabel(id)} trust setup`}>
      <span className="portal-surface__eyebrow">Setup guide</span>
      <h2 className="portal-surface__title">{providerLabel(id)} trust checklist</h2>
      <p className="portal-surface__subtitle">Complete these steps in your cloud console before expecting Connected status.</p>
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
