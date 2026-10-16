import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type AccessRequest = {
  id: string;
  status: string;
  incidentId?: number;
  incidentNumber?: string;
  createdAt?: string;
  evaluation?: { roleName?: string; risk?: string; normalizedScope?: string };
};

export default function IamRequestsPage() {
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<AccessRequest[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const response = await fetch(`${apiUrl}/api/devops/iam/access-requests`, { headers: sessionAuthHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error || 'Requests could not be loaded.');
      return;
    }
    setItems(Array.isArray(body?.requests) ? body.requests : []);
  }

  useEffect(() => { void load(); }, [apiUrl]);

  async function cancel(id: string) {
    const response = await fetch(`${apiUrl}/api/devops/iam/access-requests/${id}/cancel`, { method: 'POST', headers: sessionAuthHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error || 'This request can no longer be canceled.');
      return;
    }
    await load();
  }

  return (
    <DevOpsLayout>
      <Head><title>My access requests - IAM</title></Head>
      <IamFrame title="My requests" lede="Each request opens an incident for the DevOps team. After they approve, the grant is recorded and the incident is closed.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {items.length === 0 ? <p className="work-empty">No access requests yet.</p> : (
          <div className="portal-surface table-wrap">
            <table>
              <thead>
                <tr><th>Status</th><th>Incident</th><th>Role</th><th>Risk</th><th>Scope</th><th>Raised</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.status.replaceAll('_', ' ')}</td>
                    <td>{item.incidentId ? <a href={`/incidents/${item.incidentId}/edit`}>{item.incidentNumber || `Incident ${item.incidentId}`}</a> : '—'}</td>
                    <td>{item.evaluation?.roleName || '—'}</td>
                    <td>{item.evaluation?.risk || '—'}</td>
                    <td>{item.evaluation?.normalizedScope || '—'}</td>
                    <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      {item.status.startsWith('PENDING') ? (
                        <button type="button" className="btn btn-secondary" onClick={() => void cancel(item.id)}>Cancel</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </IamFrame>
    </DevOpsLayout>
  );
}
