import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceScope } from '@infragate/ui';
import { useApiUrl } from '../context/ApiUrlContext';
import {
  CostCloudId,
  VisibleCostProject,
  costBillingSetup,
  costCloudsForProject,
  fetchVisibleCostProjects,
  uniqueCostClouds,
} from '../lib/cost';

const FALLBACK_CLOUDS: CostCloudId[] = ['aws', 'gcp', 'azure'];

export function CostCloudBillingCard({
  cloud,
  accounts,
  projectName,
}: {
  cloud: string;
  accounts: { id: number; display_name: string; project_code?: string; project_name?: string }[];
  projectName?: string;
}) {
  const setup = costBillingSetup(cloud);
  const [showSteps, setShowSteps] = useState(false);
  return (
    <section className="portal-surface cost-sources-card" aria-label={`${setup.label} billing`}>
      <header className="cost-sources-card__head">
        <div>
          <h2 className="portal-surface__title">{setup.label} billing</h2>
          <p className="cost-sources-card__meta">
            {projectName ? `${projectName} · ` : ''}Not imported
          </p>
        </div>
        <div className="cost-setup__actions">
          <Link href="/cloud-accounts" className="btn btn-secondary btn-sm">Open cloud accounts</Link>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((open) => !open)}
          >
            {showSteps ? 'Hide setup' : 'How setup works'}
          </button>
        </div>
      </header>
      {accounts.length ? (
        <ul className="cost-pending">
          {accounts.map((account) => (
            <li key={account.id}>
              <strong>{account.display_name}</strong>
              <span>{account.project_code || account.project_name || 'Project'} · Not imported</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cost-empty__note">{setup.emptyList}</p>
      )}
      {showSteps ? (
        <ol className="cost-setup__steps">
          {setup.stages.map((step, index) => (
            <li key={step.title} className={index === 1 ? 'is-active' : undefined}>
              <span className="cost-setup__index">{index + 1}</span>
              <strong>{step.title}</strong>
              <span>{step.copy}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export default function CostSetupFlow({
  canOperate,
  state = 'none',
  sampleHref,
  primaryHref = '/cost/configuration',
  clouds,
}: {
  canOperate?: boolean;
  state?: 'none' | 'running' | 'partial' | 'failed' | 'filtered' | 'zero';
  sampleHref?: string;
  primaryHref?: string;
  clouds?: string[];
}) {
  const apiUrl = useApiUrl();
  const { scope } = useWorkspaceScope();
  const [projects, setProjects] = useState<VisibleCostProject[]>([]);
  const [catalogReady, setCatalogReady] = useState(Boolean(clouds?.length));
  const [selected, setSelected] = useState<CostCloudId>('aws');
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    if (clouds?.length) return;
    fetchVisibleCostProjects(apiUrl)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setCatalogReady(true));
  }, [apiUrl, clouds]);

  const available = useMemo(() => {
    if (clouds?.length) return uniqueCostClouds(clouds);
    if (!catalogReady) return [];
    const fromProject = costCloudsForProject(projects, scope.projectId);
    return fromProject.length ? fromProject : FALLBACK_CLOUDS;
  }, [catalogReady, clouds, projects, scope.projectId]);

  useEffect(() => {
    if (!available.includes(selected)) setSelected(available[0] || 'aws');
  }, [available, selected]);

  const setup = costBillingSetup(available.includes(selected) ? selected : (available[0] || 'aws'));
  const waiting = !catalogReady && !clouds?.length;
  const projectName = projects.find((row) => row.id === String(scope.projectId))?.name || '';
  const copy = {
    none: waiting
      ? 'Setup follows the selected project cloud. AWS, GCP, and Azure each have their own billing source.'
      : setup.emptyCopy,
    running: 'First collection is waiting on an operator import.',
    partial: 'Some billed lines are available. Incomplete amounts stay Unknown.',
    failed: 'Collection did not finish. Spend stays Unknown until a complete revision exists.',
    filtered: 'No results match the selected filters.',
    zero: 'This complete window billed zero. That is a genuine result, not missing data.',
  }[state];
  const active = state === 'running' || state === 'partial' ? 1 : state === 'zero' ? 2 : 0;
  return (
    <section className="cost-empty" aria-label="Cost setup">
      <h2>{state === 'none' && !waiting ? setup.headline : 'Connect billing data to see costs'}</h2>
      <p>{copy}</p>
      {available.length > 1 ? (
        <div className="cost-setup__clouds" role="tablist" aria-label="Project cloud">
          {available.map((cloud) => {
            const option = costBillingSetup(cloud);
            return (
              <button
                key={cloud}
                type="button"
                role="tab"
                aria-selected={selected === cloud}
                className={`cost-setup__cloud${selected === cloud ? ' is-active' : ''}`}
                onClick={() => setSelected(cloud)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : projectName ? (
        <p className="cost-setup__meta">{projectName} uses {setup.label}.</p>
      ) : null}
      <div className="cost-setup__actions">
        {canOperate !== false ? <Link href={primaryHref} className="btn btn-primary">{setup.connectLabel}</Link> : (
          <p className="cost-empty__note">Ask someone with Cost operate to connect a billing source for this project cloud.</p>
        )}
        {sampleHref ? <Link href={sampleHref} className="btn btn-secondary">View sample dashboard</Link> : null}
        <Link href="/projects/new" className="btn btn-secondary">Onboard a project</Link>
        <Link href="/cloud-accounts" className="btn btn-secondary">Connect cloud</Link>
        <Link href="/k8s" className="btn btn-secondary">Onboard cluster</Link>
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={showSteps}
          onClick={() => setShowSteps((open) => !open)}
        >
          {showSteps ? 'Hide setup steps' : 'How setup works'}
        </button>
      </div>
      {showSteps ? (
        <ol className="cost-setup__steps">
          {setup.stages.map((step, index) => (
            <li key={step.title} className={index === active ? 'is-active' : undefined}>
              <span className="cost-setup__index">{index + 1}</span>
              <strong>{step.title}</strong>
              {index === active ? <span>{step.copy}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
