import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Grant = { id: string; roleName?: string; scope?: string; status?: string; incidentNumber?: string; grantedAt?: string };

export default function IamPermissionsPage() {
  const apiUrl = useApiUrl();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${apiUrl}/api/devops/iam/access-grants`, { headers: sessionAuthHeaders() })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || 'Permissions could not be loaded.');
        setGrants(Array.isArray(body?.grants) ? body.grants : []);
      })
      .catch((err: Error) => setError(err.message));
  }, [apiUrl]);

  return (
    <DevOpsLayout>
      <Head><title>My permissions - IAM</title></Head>
      <IamFrame title="My permissions" lede="Grants appear here after the DevOps team approves and the backend records them.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {grants.length === 0 ? <p className="work-empty">No grants yet. They show up after DevOps approval.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Role</th><th>Scope</th><th>Status</th><th>Incident</th><th>Recorded</th></tr></thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>{grant.roleName || '—'}</td>
                    <td>{grant.scope || '—'}</td>
                    <td>{grant.status || '—'}</td>
                    <td>{grant.incidentNumber || '—'}</td>
                    <td>{grant.grantedAt ? new Date(grant.grantedAt).toLocaleString() : '—'}</td>
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
