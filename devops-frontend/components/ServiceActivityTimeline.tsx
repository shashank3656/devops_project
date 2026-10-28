import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';

type TimelineEvent = {
  id?: string;
  kind?: string;
  label?: string;
  summary?: string;
  detail?: string;
  at?: string;
  href?: string;
  environment?: string;
  correlation_note?: string;
  tone?: string;
};

type TimelinePayload = {
  note?: string;
  evaluated_at?: string;
  events?: TimelineEvent[];
};

export default function ServiceActivityTimeline({
  apiUrl,
  token,
  serviceId,
}: {
  apiUrl: string;
  token: string;
  serviceId: number;
}) {
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !serviceId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/services/${serviceId}/activity`, {
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
  }, [apiUrl, serviceId, token]);

  const events = Array.isArray(timeline?.events) ? timeline.events : [];

  return (
    <div className="service-timeline">
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <p className="work-empty">Loading activity…</p> : null}
      {!loading && !events.length ? <p className="work-empty">No recorded pull requests, approvals, deployments, alerts, or incidents yet.</p> : null}
      {!loading && events.length ? (
        <ul className="request-timeline">
          {events.map((event) => {
            const inner = (
              <>
                <strong>{event.summary || event.label || 'Event'}</strong>
                <span>
                  {event.label || 'Event'}
                  {event.environment ? ` · ${event.environment}` : ''}
                  {event.at ? ` · ${formatOperationalTime(event.at)}` : ''}
                </span>
                {event.detail ? <small>{event.detail}</small> : null}
                {event.correlation_note ? <small className="service-timeline__note">{event.correlation_note}</small> : null}
              </>
            );
            const href = (event.href || '').trim();
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
