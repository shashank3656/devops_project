import Link from 'next/link';
import RelativeTime from './RelativeTime';
import type { PipelineStage } from './types';

function stageTone(stage: PipelineStage): 'danger' | 'active' | 'ok' | 'idle' | 'unknown' {
  if (stage.blocked) return 'danger';
  if (stage.active) return 'active';
  const status = stage.status.toLowerCase();
  if (status === 'idle') return 'idle';
  if (status === '' || status === 'unknown') return 'unknown';
  if (status.includes('complete') || status === 'succeeded' || status === 'success' || status === 'healthy') return 'ok';
  if (status.includes('pending') || status.includes('draft') || status === 'approved' || status === 'queued') return 'active';
  return 'unknown';
}

const TONE_LABELS = {
  danger: 'Blocked',
  active: 'In flight',
  ok: 'Succeeded',
  idle: 'Quiet',
  unknown: 'Unknown',
};

export default function EnvironmentPipeline({
  stages,
  loading = false,
}: {
  projectName?: string;
  stages: PipelineStage[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="ig-home-envs" aria-busy="true">
        {[0, 1, 2].map((key) => (
          <div key={key} className="ig-home-env">
            <span className="ig-skeleton ig-skeleton--line" style={{ width: '40%' }} />
            <span className="ig-skeleton ig-skeleton--line" />
            <span className="ig-skeleton ig-skeleton--line" style={{ width: '55%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (stages.length === 0) {
    return (
      <div className="ig-home-panel ig-home-empty">
        <div>
          <strong>No environments yet</strong>
          <p>Project environments appear here as soon as a request or promotion exists.</p>
        </div>
      </div>
    );
  }

  return (
    <ol className="ig-home-envs">
      {stages.map((stage) => {
        const tone = stageTone(stage);
        const body = (
          <>
            <span className="ig-home-env__head">
              <span className="ig-home-env__name">{stage.env}</span>
              <span className={`ig-home-env__state ig-home-env__state--${tone}`}>
                <span className="ig-home-env__dot" aria-hidden />
                {TONE_LABELS[tone]}
              </span>
            </span>
            <span className="ig-home-env__summary">{stage.summary}</span>
            <span className="ig-home-env__time">{stage.updated_at ? <>updated <RelativeTime value={stage.updated_at} /></> : stage.status}</span>
          </>
        );
        return (
          <li key={stage.env}>
            {stage.href ? (
              <Link href={stage.href} className={`ig-home-env ig-home-env--${tone}`}>
                {body}
              </Link>
            ) : (
              <div className={`ig-home-env ig-home-env--${tone}`}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
