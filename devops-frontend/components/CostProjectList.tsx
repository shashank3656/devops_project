import Link from 'next/link';
import CostUnknown from './CostUnknown';
import {
  CostTreeProject,
  costAccountStatus,
  costAccountStatusLabel,
  costHref,
  costUnknownReason,
} from '../lib/cost';

export default function CostProjectList({
  projects,
  query,
  title = 'Projects',
  showProjectAction = true,
}: {
  projects: CostTreeProject[];
  query: { [key: string]: string | string[] | undefined };
  title?: string;
  showProjectAction?: boolean;
}) {
  return (
    <section className="cost-tree" aria-label={title}>
      <header className="cost-tree__head">
        <h2>{title}</h2>
        <p>Open a project or account dashboard for that billed window.</p>
      </header>
      {projects.map((project) => {
        const projectHref = costHref(project.href || `/cost/projects/${project.id}`, query);
        const projectReason = costUnknownReason({ display: project.spend?.display, coverage: project.spend?.coverage });
        return (
          <article key={project.id} className="cost-tree__project">
            <header className="cost-tree__project-head">
              <div>
                <span className="portal-surface__eyebrow">{project.code || 'Project'}</span>
                <h3 className="cost-tree__project-name">{project.name}</h3>
              </div>
              <div className="cost-tree__project-actions">
                <span className="cost-tree__spend">
                  {projectReason
                    ? <CostUnknown reason={projectReason} canOperate={project.can_operate} />
                    : (project.spend?.display || 'Unknown')}
                </span>
                {showProjectAction ? <Link href={projectHref} className="btn btn-primary btn-sm">View dashboard</Link> : null}
              </div>
            </header>
            {(project.clouds || []).map((cloud) => (
              <div key={cloud.provider} className="cost-tree__cloud">
                <div className="cost-tree__cloud-label">{cloud.provider}</div>
                {(cloud.accounts || []).map((account) => {
                  const status = costAccountStatus(account);
                  const reason = costUnknownReason({
                    display: account.spend?.display,
                    coverage: account.spend?.coverage,
                    importStatus: account.import_status,
                    freshness: account.freshness,
                    stale: Boolean(account.stale_hint),
                  });
                  const accountHref = costHref(account.href || `/cost/accounts/${account.id}`, query);
                  return (
                    <div
                      key={`${account.id}-${account.cloud_account_id}`}
                      className={`cost-tree__account${status === 'not_imported' ? ' is-missing' : ''}${status === 'stale' ? ' is-stale' : ''}`}
                    >
                      <div className="cost-tree__account-main">
                        <span className={`cost-dot cost-dot--${status}`} title={costAccountStatusLabel(status)} />
                        <span>
                          <span className="cost-tree__account-name">{account.display_name}</span>
                          <span className="cost-tree__account-meta">{account.environment || 'Unknown'} · {costAccountStatusLabel(status)}</span>
                        </span>
                      </div>
                      <span className="cost-tree__spend">
                        {reason
                          ? <CostUnknown reason={reason} canOperate={project.can_operate} />
                          : (account.spend?.display || 'Unknown')}
                      </span>
                      <Link href={accountHref} className="btn btn-secondary btn-sm">View dashboard</Link>
                    </div>
                  );
                })}
              </div>
            ))}
          </article>
        );
      })}
    </section>
  );
}
