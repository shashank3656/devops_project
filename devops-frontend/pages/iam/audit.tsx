import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type AuditEvent = { id: string; at?: string; action?: string; detail?: string; requestId?: string };

export default function IamAuditPage() {
  const apiUrl = useApiUrl();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiUrl}/api/devops/iam/audit-events`, { headers: sessionAuthHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Audit history could not be loaded.');
        setEvents(Array.isArray(body?.events) ? body.events : []);
      })
      .catch((err: Error) => setError(err.message));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head><title>Access audit - IAM</title></Head>
      <IamFrame title="Audit" lede="Evaluation, submission, and approval events stay on the request. Secret values are not stored.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {events.length === 0 ? <p className="work-empty">No access events yet.</p> : (
          <ul className="iam-audit">
            {events.map((event) => (
              <li key={event.id}>
                <span>{event.at ? new Date(event.at).toLocaleString() : '—'} · {event.action} · {event.detail}{event.requestId ? ` · ${event.requestId.slice(0, 8)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </IamFrame>
    </DevOpsLayout>
  );
}
