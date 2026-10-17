import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

const STATUS_OPTIONS = ['New', 'In progress', 'Provisioning', 'Provision failed', 'Active', 'Rejected', 'Cancelled'];

function statusLabel(status: string): string {
  const value = status.toUpperCase();
  if (!value) return 'New';
  if (value.includes('PROVISION_FAILED')) return 'Provision failed';
  if (value.includes('PROVISION')) return 'Provisioning';
  if (value.includes('PENDING')) return 'In progress';
  if (value === 'ACTIVE') return 'Active';
  if (value.includes('REJECT')) return 'Rejected';
  if (value.includes('CANCEL')) return 'Cancelled';
  return 'New';
}

function serviceOf(item: AccessRequest): string {
  return item.evaluation?.input?.service || item.evaluation?.normalizedScope || '';
}

function environmentOf(item: AccessRequest): string {
  return item.evaluation?.input?.environment || '';
}

export default function IamHomePage() {
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [environment, setEnvironment] = useState('');
  const [person, setPerson] = useState('');

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

  const environments = useMemo(() => {
    const names = new Set((requests || []).map(environmentOf).filter(Boolean));
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [requests]);
  const people = useMemo(() => {
    const names = new Set((requests || []).map((item) => item.requesterName || '').filter(Boolean));
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [requests]);
  const filtering = Boolean(query.trim() || status || environment || person);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (requests || []).filter((item) => {
      if (status && statusLabel(item.status || '') !== status) return false;
      if (environment && environmentOf(item) !== environment) return false;
      if (person && (item.requesterName || '') !== person) return false;
      if (!needle) return true;
      const haystack = [serviceOf(item), item.evaluation?.roleName, item.requesterName, environmentOf(item)].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [requests, query, status, environment, person]);

  function clearFilters() {
    setQuery('');
    setStatus('');
    setEnvironment('');
    setPerson('');
  }

  return (
    <DevOpsLayout>
      <Head><title>IAM</title></Head>
      <IamFrame title="IAM" lede="A request stays New until review, then In progress. Approval moves it to Provisioning until the access file is applied, then Active. Rejected and Cancelled stop the grant.">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        <form className="iam-filters" onSubmit={(event) => event.preventDefault()}>
          <label>
            Search
            <input
              className="input"
              type="search"
              value={query}
              placeholder="Service, permission, or person"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Status
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Environment
            <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              <option value="">All environments</option>
              {environments.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Raised by
            <select className="input" value={person} onChange={(event) => setPerson(event.target.value)}>
              <option value="">Anyone</option>
              {people.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <div className="iam-filters__actions">
            {filtering ? <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear</button> : null}
            <Link href="/iam/request" className="btn btn-primary">New access request</Link>
          </div>
        </form>
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
              ) : visible.length === 0 ? (
                <tr><td colSpan={6}>{filtering ? 'No requests match these filters.' : 'No access requests yet.'}</td></tr>
              ) : visible.map((item) => (
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
