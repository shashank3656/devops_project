import { useEffect, useState, type ReactNode } from 'react';
import ActivityFeed from './ActivityFeed';
import EnvironmentPipeline from './EnvironmentPipeline';
import WorkQueue from './WorkQueue';
import { greetingFor } from './time';
import type { WorkspacePayload } from './types';

function firstName(viewer?: string): string {
  const name = (viewer || '').trim();
  if (!name) return '';
  const first = name.split(/[\s._@-]+/).filter(Boolean)[0] || name;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default function WorkspaceHome({
  payload,
  loading = false,
  error = null,
  onRetry,
  actions,
  activityHref,
  aside,
  children,
}: {
  payload: WorkspacePayload;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  actions?: ReactNode;
  activityHref?: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const [greeting, setGreeting] = useState('Welcome back');

  useEffect(() => {
    setGreeting(greetingFor());
  }, []);

  const name = firstName(payload.viewer);
  const needsCount = payload.needs_you?.length || 0;
  const failedCount = payload.failed?.length || 0;
  const envCount = payload.pipeline?.stages?.length || 0;
  const showFailed = loading || failedCount > 0;
  const showEnvironments = loading || envCount > 0 || Boolean(payload.pipeline?.project_name);
  const summary = error
    ? 'Home could not load.'
    : loading
      ? 'Loading your workspace…'
      : needsCount === 0 && failedCount === 0
        ? "You're all caught up."
        : [
            needsCount > 0 ? `${needsCount} ${needsCount === 1 ? 'item needs' : 'items need'} you` : '',
            failedCount > 0 ? `${failedCount} ${failedCount === 1 ? 'delivery is' : 'deliveries are'} failed or blocked` : '',
          ]
            .filter(Boolean)
            .join('. ') + '.';

  return (
    <div className="ig-home">
      <header className="ig-home__header">
        <div className="ig-home__intro">
          <h1 className="ig-home__title">
            {greeting}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="ig-home__summary">
            <span className={(needsCount > 0 || failedCount > 0) && !loading && !error ? 'ig-home__count' : undefined}>
              {summary}
            </span>{' '}
            {!error ? payload.subtitle : null}
          </p>
        </div>
        {actions ? <div className="ig-home__actions">{actions}</div> : null}
      </header>

      {error ? (
        <div className="ig-home-panel ig-home-error" role="alert">
          <div>
            <strong>Workspace is unavailable</strong>
            <p>{error}</p>
          </div>
          {onRetry ? (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="ig-home__grid">
          <div className="ig-home__main">
            <section className="ig-home__section" aria-labelledby="ig-home-needs-title">
              <div className="ig-home__section-head">
                <h2 id="ig-home-needs-title">Needs my action</h2>
                {!loading && needsCount > 0 ? <span className="ig-home__pill">{needsCount}</span> : null}
              </div>
              <WorkQueue
                items={payload.needs_you || []}
                loading={loading}
                emptyTitle="You're all caught up"
                emptyBody="Approvals, assigned tickets, and assigned incidents will show up here."
              />
            </section>

            {showFailed ? (
              <section className="ig-home__section" aria-labelledby="ig-home-failed-title">
                <div className="ig-home__section-head">
                  <h2 id="ig-home-failed-title">Failed or blocked</h2>
                  {!loading && failedCount > 0 ? <span className="ig-home__pill">{failedCount}</span> : null}
                </div>
                <WorkQueue
                  items={payload.failed || []}
                  loading={loading}
                  emptyTitle="No failed deliveries"
                  emptyBody="Failed changes, rejected tickets, and blocked promotions appear here."
                />
              </section>
            ) : null}

            {showEnvironments ? (
              <section className="ig-home__section" aria-labelledby="ig-home-env-title">
                <div className="ig-home__section-head">
                  <h2 id="ig-home-env-title">Environments I own</h2>
                  {payload.pipeline?.project_name ? (
                    <span className="ig-home__section-note">{payload.pipeline.project_name}</span>
                  ) : null}
                </div>
                <EnvironmentPipeline stages={payload.pipeline?.stages || []} loading={loading} />
              </section>
            ) : null}

            {children}
          </div>

          <aside className="ig-home__aside">
            <ActivityFeed
              items={payload.activity || []}
              loading={loading}
              title="Recent operations"
              viewAllHref={activityHref}
            />
            {aside}
          </aside>
        </div>
      )}
    </div>
  );
}
