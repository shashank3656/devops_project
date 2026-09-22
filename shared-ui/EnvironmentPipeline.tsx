import Link from 'next/link';
import EmptyState from './EmptyState';
import StatusChip from './StatusChip';
import type { PipelineStage } from './types';

export default function EnvironmentPipeline({
  projectName,
  stages,
}: {
  projectName?: string;
  stages: PipelineStage[];
}) {
  return (
    <section className="ig-pipeline">
      <span className="ig-eyebrow">Environment pipeline</span>
      <h2>{projectName || 'Release path'}</h2>
      {stages.length === 0 ? (
        <EmptyState title="No environments yet" body="Project environments appear here as soon as a request or promotion exists." />
      ) : (
        <>
          <div className="ig-pipeline__track">
            {stages.map((stage) => (
              <div
                key={stage.env}
                className={`ig-pipeline__node ${stage.blocked ? 'is-blocked' : ''} ${stage.active ? 'is-active' : ''}`}
              >
                {stage.env}
              </div>
            ))}
          </div>
          <ul className="ig-pipeline__stages">
            {stages.map((stage) => {
              const body = (
                <>
                  <div>
                    <div className="ig-pipeline__env">{stage.env.toUpperCase()}</div>
                    <div className="ig-pipeline__summary">{stage.summary}</div>
                  </div>
                  <StatusChip tone={stage.blocked ? 'danger' : stage.active ? 'info' : 'ok'} label={stage.status} />
                </>
              );
              return (
                <li key={`${stage.env}-row`}>
                  {stage.href ? (
                    <Link href={stage.href} className="ig-pipeline__stage">
                      {body}
                    </Link>
                  ) : (
                    <div className="ig-pipeline__stage">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
