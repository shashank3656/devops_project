import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';

type TimelineEvent = {
  id?: string;
  kind?: string;
  label?: string;
  summary?: string;
  detail?: string;
  at?: string;
  href?: string;
  evidence_href?: string;
  evidence_label?: string;
  environment?: string;
  correlation_note?: string;
  tone?: string;
};

type TimelinePayload = {
  note?: string;
  evaluated_at?: string;
  events?: TimelineEvent[];
};

const KIND_FILTERS = [
  { id: '', label: 'All events' },
  { id: 'deployment', label: 'Deployments' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'incident', label: 'Incidents' },
  { id: 'slo', label: 'SLO breaches' },
];

function evidenceHref(event: TimelineEvent): string {
  return (event.evidence_href || event.href || '').trim();
}

export default function ServiceActivityTimeline({
  apiUrl,
  token,
  serviceId,
  environment,
}: {
  apiUrl: string;
  token: string;
  serviceId: number;
  environment?: string;
}) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('');
  const [envFilter, setEnvFilter] = useState(environment || '');

  useEffect(() => {
    setEnvFilter(environment || '');
  }, [environment]);

  useEffect(() => {
    if (!token || !serviceId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (envFilter) params.set('environment', envFilter);
    const query = params.toString();
    fetch(`${apiUrl}/api/devops/services/${serviceId}/activity${query ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Activity could not be loaded.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setTimeline((data?.timeline || null) as TimelinePayload | null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Activity could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, envFilter, serviceId, token]);

  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  const visible = useMemo(() => (kind ? events.filter((item) => item.kind === kind) : events), [events, kind]);

  return (
    <div className="service-timeline">
      <div className="service-timeline__filters" role="group" aria-label="Timeline filters">
        {KIND_FILTERS.map((item) => (
          <button
            key={item.id || 'all'}
            type="button"
            className={`btn btn-sm ${kind === item.id ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={kind === item.id}
            onClick={() => setKind(item.id)}
          >
            {item.label}
          </button>
        ))}
        {environment ? (
          <label className="service-timeline__env">
            <span className="ig-sr-only">Environment</span>
            <select className="input" aria-label="Environment" value={envFilter} onChange={(event) => setEnvFilter(event.target.value)}>
              <option value={environment}>{environment}</option>
              <option value="">All environments</option>
            </select>
          </label>
        ) : null}
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="work-empty">Loading activity…</p> : null}
      {!loading && !visible.length ? <p className="work-empty">No recorded deployments, configuration changes, incidents, or SLO breaches for this selection. Missing telemetry stays Unknown.</p> : null}
      {!loading && visible.length ? (
        <ul className="request-timeline">
          {visible.map((event) => {
            const href = evidenceHref(event);
            const inner = (
              <>
                <strong>{event.summary || event.label || 'Event'}</strong>
                <span>
                  {event.label || 'Event'}
                  {event.environment ? ` · ${event.environment}` : ''}
                  {event.at ? ` · ${formatOperationalTime(event.at)}` : ''}
                </span>
                {event.detail ? <small>{event.detail}</small> : null}
                {href ? <small>Evidence: {event.evidence_label || 'Source record'}</small> : <small>Evidence: Unknown</small>}
                {event.correlation_note ? <small className="service-timeline__note">{event.correlation_note}</small> : null}
              </>
            );
            const external = href.startsWith('http');
            return (
              <li key={event.id || `${event.kind}-${event.at}`} className={event.tone ? `is-${event.tone}` : undefined}>
                {href && !external ? <Link href={href}>{inner}</Link> : null}
                {href && external ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {inner}
                  </a>
                ) : null}
                {!href ? inner : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="access-hint">
        {timeline?.note || 'Nearby timestamps are labelled as correlation, not proven cause.'}
        {timeline?.evaluated_at ? ` Loaded ${formatOperationalTime(timeline.evaluated_at)}.` : ''}
      </p>
    </div>
  );
}
