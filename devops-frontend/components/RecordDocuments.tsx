import { useEffect, useState } from 'react';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

type RecordDocumentKind = 'incidents' | 'changes' | 'problems';

type RecordDocument = {
  id: number;
  original_name: string;
  content_type?: string;
  byte_size?: number;
  uploaded_by_username?: string;
  created_at?: string;
};

function formatBytes(value?: number) {
  if (!value || value <= 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecordDocuments({
  apiUrl,
  kind,
  recordId,
}: {
  apiUrl: string;
  kind: RecordDocumentKind;
  recordId: number | string;
}) {
  const [items, setItems] = useState<RecordDocument[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const numericId = typeof recordId === 'number' ? recordId : Number(recordId);
  const path = Number.isSafeInteger(numericId) && numericId > 0
    ? `/api/devops/${kind}/${numericId}/documents`
    : '';

  function authHeaders() {
    return { Authorization: `Bearer ${localStorage.getItem(DEVOPS_TOKEN_KEY) || ''}` };
  }

  async function load() {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !path) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}${path}`, { headers: authHeaders() });
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Could not load documents'));
      }
      const list = Array.isArray(data.documents) ? data.documents : [];
      setItems(list.filter((entry): entry is RecordDocument => Boolean(
        entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'number',
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiUrl, kind, recordId]);

  async function upload(file: File) {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !path) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: authHeaders(),
        body,
      });
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Could not upload the file'));
      }
      const saved = data.document && typeof data.document === 'object' ? data.document as RecordDocument : null;
      if (saved?.id) {
        setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      } else {
        await load();
      }
      setNotice(`${file.name} uploaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the file');
    } finally {
      setUploading(false);
    }
  }

  async function download(item: RecordDocument) {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !path) return;
    setError('');
    try {
      const response = await fetch(`${apiUrl}${path}/${item.id}`, { headers: authHeaders() });
      if (!response.ok) {
        const data = asRecord(await response.json().catch(() => ({})));
        throw new Error(getString(data.error, 'Could not download the file'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.original_name || 'document';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the file');
    }
  }

  async function remove(item: RecordDocument) {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !path) return;
    setError('');
    try {
      const response = await fetch(`${apiUrl}${path}/${item.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Could not remove the file'));
      }
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the file');
    }
  }

  return (
    <div className="record-docs">
      <h2 className="chg-detail__section-title">Documents</h2>
      <p className="chg-detail__hint">Files are stored in the Incidents S3 bucket. They are not kept in the database.</p>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {notice ? <div className="alert alert-success">{notice}</div> : null}
      {loading ? <p className="chg-detail__hint">Loading documents…</p> : null}
      {!loading && items.length === 0 ? <p className="chg-detail__hint">No documents yet.</p> : null}
      {items.length ? (
        <ul className="request-timeline">
          {items.map((item) => (
            <li key={item.id} className="record-docs__row">
              <span>
                {item.original_name}
                <small>
                  {[formatBytes(item.byte_size), item.uploaded_by_username, item.created_at ? new Date(item.created_at).toLocaleString() : '']
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <span className="record-docs__actions">
                <button type="button" className="btn btn-secondary" onClick={() => void download(item)}>Download</button>
                <button type="button" className="btn btn-secondary" onClick={() => void remove(item)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="label">
        Upload a file
        <input
          className="input"
          type="file"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
    </div>
  );
}
