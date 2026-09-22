import type { ReactNode } from 'react';
import EnvironmentPipeline from './EnvironmentPipeline';
import PageHeader from './PageHeader';
import WorkQueue from './WorkQueue';
import type { WorkspacePayload } from './types';

export default function WorkspaceHome({
  payload,
  actions,
}: {
  payload: WorkspacePayload;
  actions?: ReactNode;
}) {
  return (
    <div className="portal-page">
      <PageHeader eyebrow="Overview" title={payload.title} subtitle={payload.subtitle} actions={actions} />
      <div className="ig-workspace">
        <WorkQueue title="What needs you" items={payload.needs_you || []} />
        <EnvironmentPipeline projectName={payload.pipeline?.project_name} stages={payload.pipeline?.stages || []} />
      </div>
    </div>
  );
}
