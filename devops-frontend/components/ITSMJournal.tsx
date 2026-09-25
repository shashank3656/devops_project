import { useState } from 'react';
import { ITSMJournalEntry } from '../lib/itsm';
import { asRecord, getString } from '../lib/payload';

const DEVOPS_TOKEN_KEY = 'devops_token';

export default function ITSMJournal({
  apiUrl,
  path,
  entries,
  onPosted,
}: {
  apiUrl: string;
  path: string;
  entries: ITSMJournalEntry[];
  onPosted: (entries: ITSMJournalEntry[]) => void;
}) {
  const [kind, setKind] = useState<'work_note' | 'comment'>('work_note');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token || !body.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, body: body.trim() }),
      });
      const data = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        throw new Error(getString(data.error, 'Failed to post note'));
      }
      const entry = data.entry && typeof data.entry === 'object' ? data.entry : null;
      const next = entry
        ? [...entries, {
          id: typeof (entry as { id?: number }).id === 'number' ? (entry as { id: number }).id : Date.now(),
          kind,
          body: body.trim(),
          author_username: typeof (entry as { author_username?: string }).author_username === 'string' ? (entry as { author_username: string }).author_username : '',
          created_at: typeof (entry as { created_at?: string }).created_at === 'string' ? (entry as { created_at: string }).created_at : new Date().toISOString(),
        }]
        : entries;
      onPosted(next);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="portal-surface" style={{ marginTop: 16 }}>
      <div className="portal-surface__header">
        <div>
          <span className="portal-surface__eyebrow">Activity</span>
          <h2 className="portal-surface__title">Work notes and customer comments</h2>
          <p className="portal-surface__subtitle">Work notes stay internal. Customer comments are the visible update stream.</p>
        </div>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {entries.length ? (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {entries.map((entry) => (
            <div key={entry.id} style={{ border: '1px solid var(--color-border, #d0d5dd)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {entry.kind === 'comment' ? 'Customer comment' : 'Work note'}
                {entry.author_username ? ` · ${entry.author_username}` : ''}
                {entry.created_at ? ` · ${new Date(entry.created_at).toLocaleString()}` : ''}
              </div>
              <div>{entry.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="portal-surface__subtitle">No notes yet.</p>
      )}
      <div className="portal-form-grid">
        <label className="label">
          Note type
          <select className="input" value={kind} onChange={(event) => setKind(event.target.value as 'work_note' | 'comment')}>
            <option value="work_note">Work note (internal)</option>
            <option value="comment">Customer comment</option>
          </select>
        </label>
      </div>
      <label className="label">
        {kind === 'comment' ? 'Customer comment' : 'Work note'}
        <textarea className="input" rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder={kind === 'comment' ? 'Visible update for the caller' : 'Internal investigation note'} />
      </label>
      <div className="portal-form-actions">
        <button type="button" className="btn btn-secondary" disabled={saving || !body.trim()} onClick={() => void submit()}>
          {saving ? 'Posting...' : 'Post note'}
        </button>
      </div>
    </section>
  );
}
