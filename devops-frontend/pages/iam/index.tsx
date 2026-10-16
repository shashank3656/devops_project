import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';
import { loadTicketAudience } from '../../lib/ticketAudience';

type AccessRequest = {
  id: string;
  status?: string;
  requesterName?: string;
  createdAt?: string;
  evaluation?: { roleName?: string; normalizedScope?: string; input?: { service?: string; environment?: string } };
};

function statusLabel(status: string): string {
  const value = status.toUpperCase();
  if (!value) return 'New';
  if (value.includes('PENDING')) return 'In progress';
  if (value === 'ACTIVE') return 'Active';
  if (value.includes('REJECT')) return 'Rejected';
  if (value.includes('CANCEL')) return 'Cancelled';
  return 'New';
}

export default function IamHomePage() {
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    loadTicketAudience(apiUrl)
      .then((audience) => {
        const scope = audience.scope === 'all' ? 'desk' : audience.scope === 'team' ? 'team' : '';
        const query = scope ? `?scope=${scope}` : '';
        return fetch(`${apiUrl}/api/devops/iam/access-requests${query}`, { headers: sessionAuthHeaders() });
      })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Access requests could not be loaded.');
        if (!cancel) setRequests(Array.isArray(body?.requests) ? body.requests : []);
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head><title>IAM</title></Head>
      <IamFrame title="IAM" lede="Requests waiting here are New until a reviewer picks them up, then In progress, Active, or Rejected.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <div className="iam-actions">
          <Link href="/iam/request" className="btn btn-primary">New access request</Link>
        </div>
        <div className="portal-surface table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Service</th>
                <th>Permission</th>
                <th>Environment</th>
                <th>Raised by</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {requests === null ? (
                <tr><td colSpan={6}>Loading requests…</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={6}>No access requests yet.</td></tr>
              ) : requests.map((item) => (
                <tr key={item.id}>
                  <td>{statusLabel(item.status || '')}</td>
                  <td>{item.evaluation?.input?.service || item.evaluation?.normalizedScope || '—'}</td>
                  <td>{item.evaluation?.roleName || '—'}</td>
                  <td>{item.evaluation?.input?.environment || '—'}</td>
                  <td>{item.requesterName || '—'}</td>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </IamFrame>
    </DevOpsLayout>
  );
}
