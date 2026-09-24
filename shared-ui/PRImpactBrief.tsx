import StatusChip from './StatusChip';
import type { PRImpactBriefData } from './types';

export default function PRImpactBrief({ brief, compact }: { brief: PRImpactBriefData; compact?: boolean }) {
  return (
    <section className="ig-brief">
      <span className="ig-eyebrow">PR impact</span>
      <div className="ig-page-header" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: compact ? 18 : 22 }}>{brief.title || `PR #${brief.pr_number || brief.request_id}`}</h2>
          <p>{brief.summary}</p>
        </div>
        <StatusChip tone={brief.risk_level} label={`${brief.risk_level} · ${brief.score}`} />
      </div>
      <div className="ig-brief__stats">
        <div><strong>{brief.commit_count}</strong>commits</div>
        <div><strong>{brief.file_count}</strong>files</div>
        <div><strong>+{brief.additions}/-{brief.deletions}</strong>diff</div>
        <div><strong>{(brief.environment || 'n/a').toUpperCase()}</strong>lands in</div>
      </div>
      {brief.change_brief?.headline ? (
        <p className="ig-muted" style={{ marginTop: 12 }}>
          Changing: {brief.change_brief.headline}
          {brief.change_brief.multi_env ? ' · more than one environment' : ''}
        </p>
      ) : null}
      {brief.plan_delta?.has_plan ? (
        <p className="ig-muted" style={{ marginTop: 8 }}>
          Plan vs PR: {brief.plan_delta.summary}
        </p>
      ) : null}
      {brief.similar_merges?.length ? (
        <ul className="ig-brief__list" style={{ marginTop: 8 }}>
          {brief.similar_merges.map((item) => (
            <li key={item.pr_number} className="ig-brief__row">
              <div className="ig-brief__meta">
                Similar: #{item.pr_number} {item.headline || item.title}
                {item.overlap?.length ? ` · ${item.overlap.join(', ')}` : ''}
                {item.later_revert ? ` · later revert #${item.later_revert.pr_number}` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {brief.change_brief?.risk_because?.length ? (
        <ul className="ig-brief__list" style={{ marginTop: 8 }}>
          {brief.change_brief.risk_because.map((reason) => (
            <li key={reason} className="ig-brief__row">
              <div className="ig-brief__meta">{reason}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="ig-muted" style={{ marginTop: 12 }}>{brief.recommended_action}</p>
      {brief.blast_radius?.length ? (
        <p className="ig-muted">Blast radius: {brief.blast_radius.join(', ')}</p>
      ) : null}
      {!compact && brief.factors?.length ? (
        <ul className="ig-brief__list">
          {brief.factors.slice(0, 6).map((factor) => (
            <li key={factor.key} className="ig-brief__row">
              <div>
                <div className="ig-queue__title">{factor.label}</div>
                <div className="ig-brief__meta">{factor.detail}</div>
              </div>
              <StatusChip tone={factor.severity} />
            </li>
          ))}
        </ul>
      ) : null}
      {brief.pr_url ? (
        <p style={{ marginTop: 16 }}>
          <a href={brief.pr_url} target="_blank" rel="noreferrer">Open on GitHub</a>
        </p>
      ) : null}
    </section>
  );
}
