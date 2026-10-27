import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
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
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Changes</span>
            <h1 className="portal-page__title">Preview environments</h1>
            <p className="portal-page__subtitle">
              Opening a PR on an onboarded repo starts a preview CHG. Merge or close tears it down and records estimated cost on the PR brief. Editing the repository name updates the catalog only.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {notice ? <div className="alert alert-success">{notice}</div> : null}
        {loading ? <div className="empty-state">Loading previews…</div> : null}
        {!loading && items.length === 0 ? (
          <div className="empty-state">
            <p>No preview environments yet. Open a PR against an onboarded repo. Merge or close tears the preview down.</p>
            <Link href="/deploy-intelligence/onboard" className="btn btn-primary btn-sm">Onboard a repository</Link>
          </div>
        ) : null}
        {items.length > 0 ? (
          <section className="portal-surface">
            <table className="table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Repo</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.pr_number}{item.branch ? ` · ${item.branch}` : ''}</td>
                    <td>
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
                      ) : (
                        <div className="portal-page__actions">
                          <span>{item.repo || 'Unknown'}</span>
                          {canWrite ? (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>
                              Edit repo
                            </button>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>{item.status}</td>
                    <td>${(item.estimated_cost_usd || 0).toFixed(2)}</td>
                    <td>
                      {item.change_id ? (
                        <Link href={`/changes/${item.change_id}`}>{item.change_number || `CHG ${item.change_id}`}</Link>
                      ) : '—'}
                      {item.url ? (
                        <>
                          {' · '}
                          <a href={item.url} target="_blank" rel="noreferrer">Open</a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!canWrite ? <p className="access-hint">A viewer can read this catalog. Editing the repository name needs write access.</p> : null}
          </section>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
