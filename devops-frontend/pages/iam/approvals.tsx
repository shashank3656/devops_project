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
    setNotice(body?.status === 'ACTIVE'
      ? 'Approved. The grant is recorded and the incident is closed.'
      : 'Rejected. No grant was recorded and the incident is closed.');
    await load();
  }

  return (
    <DevOpsLayout>
      <Head><title>Access approvals - IAM</title></Head>
      <IamFrame title="Approvals" lede="These requests are waiting for the DevOps team. Approving records the grant and closes the incident. You cannot approve a request you opened.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
        {items.length === 0 ? <p className="work-empty">No requests are waiting for you.</p> : items.map((item) => (
          <section key={item.id} className="portal-surface access-form">
            <h2 className="access-form__title">{item.evaluation?.roleName || 'Access request'}</h2>
            <p className="access-hint">{item.status.replaceAll('_', ' ')} · {item.evaluation?.risk}</p>
            <p className="access-hint">{item.evaluation?.normalizedScope}</p>
            <p className="access-hint">Ticket {item.evaluation?.request?.ticketRef || '—'} · {item.evaluation?.request?.justification || 'No justification'}</p>
            <div className="access-create__end">
              <button type="button" className="btn btn-primary" onClick={() => void decide(item, 'approved')}>Approve</button>
              <button type="button" className="btn btn-secondary" onClick={() => void decide(item, 'rejected')}>Reject</button>
            </div>
          </section>
        ))}
      </IamFrame>
    </DevOpsLayout>
  );
}
