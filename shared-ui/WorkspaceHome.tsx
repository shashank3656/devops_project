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
  actions,
  activityHref,
  aside,
  children,
}: {
  payload: WorkspacePayload;
  loading?: boolean;
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
  const count = payload.needs_you?.length || 0;
  const summary = loading
    ? 'Loading your workspace…'
    : count === 0
      ? "You're all caught up."
      : `${count} ${count === 1 ? 'item needs' : 'items need'} you.`;

  return (
    <div className="ig-home">
      <header className="ig-home__header">
        <div className="ig-home__intro">
          <h1 className="ig-home__title">
            {greeting}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="ig-home__summary">
            <span className={count > 0 && !loading ? 'ig-home__count' : undefined}>{summary}</span> {payload.subtitle}
          </p>
        </div>
        {actions ? <div className="ig-home__actions">{actions}</div> : null}
      </header>

      <div className="ig-home__grid">
        <div className="ig-home__main">
          <section className="ig-home__section" aria-labelledby="ig-home-needs-title">
            <div className="ig-home__section-head">
              <h2 id="ig-home-needs-title">Needs you</h2>
              {!loading && count > 0 ? <span className="ig-home__pill">{count}</span> : null}
            </div>
            <WorkQueue items={payload.needs_you || []} loading={loading} />
          </section>

          <section className="ig-home__section" aria-labelledby="ig-home-env-title">
            <div className="ig-home__section-head">
              <h2 id="ig-home-env-title">Environments</h2>
              {payload.pipeline?.project_name ? (
                <span className="ig-home__section-note">{payload.pipeline.project_name}</span>
              ) : null}
            </div>
            <EnvironmentPipeline stages={payload.pipeline?.stages || []} loading={loading} />
          </section>

          {children}
        </div>

        <aside className="ig-home__aside">
          <ActivityFeed items={payload.activity || []} loading={loading} viewAllHref={activityHref} />
          {aside}
        </aside>
      </div>
    </div>
  );
}
