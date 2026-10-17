import Head from 'next/head';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import IamFrame from '../../components/IamFrame';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

type Approval = {
  id: string;
  status: string;
  versionHash: string;
  accessNumber?: string;
  provisionFile?: string;
  provisionUrl?: string;
  evaluation?: { roleName?: string; risk?: string; normalizedScope?: string; request?: { justification?: string; ticketRef?: string } };
};

export default function IamApprovalsPage() {
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<Approval[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const response = await fetch(`${apiUrl}/api/devops/iam/approvals`, { headers: sessionAuthHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error || 'Approvals could not be loaded.');
      return;
    }
    setItems(Array.isArray(body?.approvals) ? body.approvals : []);
  }

  useEffect(() => { void load(); }, [apiUrl]);

  async function decide(item: Approval, decision: 'approved' | 'rejected') {
    setError('');
    setNotice('');
    const response = await fetch(`${apiUrl}/api/devops/iam/approvals/${item.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({ decision, versionHash: item.versionHash, comment: '' }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error || 'The decision was not recorded.');
      return;
    }
    if (body?.status === 'PROVISIONING') {
      setNotice(body.provisionFile ? `Approved. The access file ${body.provisionFile} is being opened.` : 'Approved. The access file workflow has started.');
    } else if (body?.status === 'ACTIVE') {
      setNotice('Approved. The grant is recorded.');
    } else {
      setNotice('Rejected. No grant was recorded.');
    }
    await load();
  }

  return (
    <DevOpsLayout>
      <Head><title>Access approvals - IAM</title></Head>
      <IamFrame title="Approvals" lede="These access requests are waiting for the DevOps team. Approving starts the access file workflow. You cannot approve a request you opened.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
        {items.length === 0 ? <p className="work-empty">No requests are waiting for you.</p> : (
          <div className="portal-surface table-wrap">
            <table>
              <thead>
                <tr><th>Role</th><th>Risk</th><th>Scope</th><th>Why</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.evaluation?.roleName || 'Access request'}</td>
                    <td>{item.evaluation?.risk || '—'}</td>
                    <td>{item.evaluation?.normalizedScope || '—'}</td>
                    <td>{item.evaluation?.request?.justification || 'No justification'}</td>
                    <td className="iam-actions">
                      <button type="button" className="btn btn-primary" onClick={() => void decide(item, 'approved')}>Approve</button>
                      <button type="button" className="btn btn-secondary" onClick={() => void decide(item, 'rejected')}>Reject</button>
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
