import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import DeliveryHubNav from '../components/DeliveryHubNav';
import DevOpsLayout from '../components/DevOpsLayout';
import { sessionRole } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface PreviewRow {
  id: number;
  repo: string;
  pr_number: number;
  branch?: string;
  url?: string;
  status: string;
  change_id?: number;
  change_number?: string;
  estimated_cost_usd?: number;
  updated_at: string;
  torn_down_at?: string;
}

export default function PreviewsCatalogPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const canWrite = sessionRole() !== 'viewer';
  const [items, setItems] = useState<PreviewRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(0);
  const [draftRepo, setDraftRepo] = useState('');
  const [savingId, setSavingId] = useState(0);

  const loadPreviews = useCallback(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/devops/previews`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load previews');
        setItems(Array.isArray(data.previews) ? data.previews : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load previews'))
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  useEffect(() => {
    loadPreviews();
  }, [loadPreviews]);

  const startEdit = (item: PreviewRow) => {
    setError('');
    setNotice('');
    setEditingId(item.id);
    setDraftRepo(item.repo);
  };

  const cancelEdit = () => {
    setEditingId(0);
    setDraftRepo('');
  };

  const saveRepo = async (event: FormEvent, item: PreviewRow) => {
    event.preventDefault();
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !canWrite || savingId) return;
    setSavingId(item.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/devops/previews/${item.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: draftRepo }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'The repository name could not be saved.');
        return;
      }
      const updated = data.preview && typeof data.preview === 'object' ? data.preview as PreviewRow : { ...item, repo: draftRepo.trim() };
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, ...updated } : row)));
      setNotice('Catalog repository name updated. The preview host was not moved or torn down.');
      cancelEdit();
    } catch {
      setError('The repository name could not be saved.');
    } finally {
      setSavingId(0);
    }
  };

  return (
    <DevOpsLayout>
      <Head>
        <title>Preview environments - OpsTrellis</title>
      </Head>
      <div className="delivery-shell">
        <header className="delivery-head">
          <div>
            <p className="delivery-kicker">Delivery</p>
            <h1 className="delivery-title">Preview environments</h1>
            <p className="delivery-lede">Review preview hosts for open PRs. Estimated cost is recorded on the change, not the cloud bill.</p>
          </div>
        </header>
        <DeliveryHubNav active="previews" />
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {loading ? <p className="delivery-empty">Loading previews…</p> : null}
        {!loading && items.length === 0 ? (
          <div className="delivery-empty-panel">
            <h2>Preview environments are not configured yet</h2>
            <p>A live preview needs a connected GitHub repository and an open PR against that repo. Merge or close tears the host down.</p>
            <ol className="delivery-steps">
              <li>Connect a repository that already exists on GitHub.</li>
              <li>Open a pull request against the watched base branch.</li>
              <li>Return here to review the URL, estimated cost, and cleanup status.</li>
            </ol>
            <Link href="/deploy-intelligence/onboard" className="btn btn-primary">Connect repository</Link>
          </div>
        ) : null}
        {items.length > 0 ? (
          <section className="delivery-panel">
            <table className="delivery-table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Environment status</th>
                  <th>URL</th>
                  <th>Expiry</th>
                  <th>Estimated cost</th>
                  <th>Cleanup</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const cleanup = item.torn_down_at ? 'Cleaned up' : item.status === 'live' ? 'Active' : item.status || 'Unknown';
                  return (
                  <tr key={item.id}>
                    <td>
                      <span className="delivery-pr-link__title">#{item.pr_number}</span>
                      <span className="delivery-pr-link__meta">{item.repo || 'Unknown'}{item.branch ? ` · ${item.branch}` : ''}</span>
                      {editingId === item.id ? (
                        <form className="portal-page__actions" onSubmit={(event) => void saveRepo(event, item)}>
                          <label className="label" style={{ margin: 0 }}>
                            Repository
                            <input
                              className="input"
                              value={draftRepo}
                              onChange={(event) => setDraftRepo(event.target.value)}
                              placeholder="owner/name"
                              autoComplete="off"
                              disabled={savingId === item.id}
                            />
                          </label>
                          <button type="submit" className="btn btn-primary btn-sm" disabled={savingId === item.id || !draftRepo.trim()}>
                            {savingId === item.id ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEdit} disabled={savingId === item.id}>
                            Cancel
                          </button>
                        </form>
                      ) : canWrite ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>
                          Edit repo
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <span className={`delivery-status delivery-status--${item.status === 'live' ? 'ok' : item.torn_down_at ? 'unknown' : 'pending'}`}>
                        {item.status || 'Unknown'}
                      </span>
                    </td>
                    <td>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.url}</a> : 'Unknown'}</td>
                    <td>Unknown</td>
                    <td>${(item.estimated_cost_usd || 0).toFixed(2)}</td>
                    <td>{cleanup}</td>
                    <td>
                      {item.url ? (
                        <a className="btn btn-primary btn-sm" href={item.url} target="_blank" rel="noreferrer">View preview</a>
                      ) : item.change_id ? (
                        <Link href={`/changes/${item.change_id}`} className="btn btn-secondary btn-sm">View change</Link>
                      ) : '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {!canWrite ? <p className="access-hint">A viewer can read this catalog. Editing the repository name needs write access.</p> : null}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
