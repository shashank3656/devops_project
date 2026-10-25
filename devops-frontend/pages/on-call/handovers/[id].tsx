import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type Item = {
  id: number;
  source_type: string;
  source_ref: string;
  title: string;
  owner_name: string;
  state: string;
  next_action: string;
  href: string;
  critical: boolean;
  section: string;
};

type Action = {
  id: number;
  title: string;
  owner_name: string;
  next_action: string;
  status: string;
  carried: boolean;
  source_ref: string;
};

type Person = { user_id: number; name: string };

type Delta = {
  added: Item[];
  removed: Item[];
  changed: { source_ref: string; title: string; before: string; after: string }[];
  note: string;
};

type Handover = {
  id: number;
  team_name: string;
  timezone: string;
  shift_date: string;
  outgoing_name: string;
  incoming_name: string;
  incoming_user_id: number;
  state: string;
  revision: number;
  notes: string;
  collection_status: string;
  missing_sections: string[];
  freshness: string;
  incident_assignment: string;
  reassign_incidents_on_ack?: boolean;
  incidents_reassigned?: number;
  incident_reassign_note?: string;
  items: Item[];
  actions: Action[];
  revisions: { revision: number; state: string; created_at: string }[];
  people: Person[];
  delta?: Delta;
  can_edit: boolean;
  can_submit: boolean;
  can_acknowledge: boolean;
  can_cancel: boolean;
  can_reassign: boolean;
};

function known(value: string | undefined): string {
  return (value || '').trim() || 'Unknown';
}

export default function HandoverDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const id = Number(router.query.id);
  const [tab, setTab] = useState('summary');
  const [item, setItem] = useState<Handover | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewed, setReviewed] = useState<Record<number, boolean>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [actionTitle, setActionTitle] = useState('');
  const [incomingUserId, setIncomingUserId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignIncidents, setReassignIncidents] = useState(false);

  const load = () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    fetch(`${apiUrl}/api/oncall/handovers/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'That handover is not available.');
          return;
        }
        const next = data.handover as Handover;
        setItem(next);
        setNotes(next.notes || '');
        setIncomingUserId(next.incoming_user_id ? String(next.incoming_user_id) : '');
        setReassignIncidents(Boolean(next.reassign_incidents_on_ack));
        setError('');
      })
      .catch(() => setError('That handover is not available.'));
  };

  useEffect(() => { load(); }, [apiUrl, id]);

  const openWork = useMemo(() => (item?.items || []).filter((row) => row.section === 'open_work'), [item]);
  const upcoming = useMemo(() => (item?.items || []).filter((row) => row.section === 'upcoming_risk'), [item]);
  const critical = useMemo(() => (item?.items || []).filter((row) => row.critical), [item]);

  const post = async (path: string, body: Record<string, unknown>, success: string) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !id) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/handovers/${id}/${path}`, {
        method: path === 'draft' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : success);
        return;
      }
      setItem(data.handover);
      setNotes(data.handover?.notes || notes);
      if (data.handover?.incoming_user_id) setIncomingUserId(String(data.handover.incoming_user_id));
      const delta = data.handover?.delta;
      const live = (delta?.added?.length || 0) + (delta?.removed?.length || 0) + (delta?.changed?.length || 0);
      setNote((path === 'submit' || path === 'acknowledge') && live > 0
        ? `${success} ${live} live changes since collection. The snapshot is unchanged.`
        : success);
    } catch {
      setError(success);
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    void post('draft', { notes, incoming_user_id: Number(incomingUserId) || 0 }, 'Draft saved. Collected facts were not rewritten.');
  };

  const ItemList = ({ rows, empty }: { rows: Item[]; empty: string }) => (
    rows.length ? (
      <ul className="handover-cards">
        {rows.map((row) => (
          <li key={row.id} className="portal-surface">
            <p><strong>{row.critical ? 'Critical · ' : ''}{known(row.source_ref)}</strong> {known(row.title)}</p>
            <p>What happened: collected {row.source_type} still {known(row.state)}.</p>
            <p>Current state: owner {known(row.owner_name)}.</p>
            <p>Next action: {known(row.next_action)}</p>
            {row.href ? <p><Link href={row.href}>Open source</Link></p> : null}
            {item?.can_acknowledge && row.critical ? (
              <label>
                <input type="checkbox" checked={Boolean(reviewed[row.id])} onChange={(event) => setReviewed((current) => ({ ...current, [row.id]: event.target.checked }))} /> Reviewed
                <input className="input" placeholder="Reason if not reviewed" value={reasons[row.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))} />
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    ) : <div className="empty-state">{empty}</div>
  );

  return (
    <DevOpsLayout>
      <Head><title>{item ? `Handover ${item.team_name}` : 'Handover'}</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">{item ? known(item.team_name) : 'Handover'}</h1>
            <p className="portal-page__subtitle">{item ? `${item.shift_date} · ${item.timezone} · ${known(item.outgoing_name)} to ${known(item.incoming_name)}` : 'Loading shift details.'}</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/on-call/handovers" className="btn btn-secondary">All handovers</Link>
          </div>
        </div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {note ? <div className="alert alert-success">{note}</div> : null}
        {!item ? <div className="empty-state">Loading handover…</div> : (
          <>
            <div className="portal-pill-row">
              <span className="portal-pill">{known(item.state)}</span>
              <span className="portal-pill">Revision {item.revision}</span>
              <span className="portal-pill">{known(item.freshness)}</span>
              <span className="portal-pill">{item.collection_status === 'partial' ? 'Partial collection' : 'Collection complete'}</span>
            </div>
            <p className="access-hint">{item.incident_assignment}</p>
            {item.incident_reassign_note ? <p className="access-hint">{item.incident_reassign_note}</p> : null}
            {item.missing_sections?.length ? (
              <div className="alert alert-error" role="status">
                Partial: {item.missing_sections.join(' ')}
              </div>
            ) : null}
            <div className="portal-tabs" role="tablist">
              {['summary', 'open', 'risk', 'actions', 'changed', 'history'].map((key) => (
                <button key={key} type="button" className={`btn btn-sm ${tab === key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(key)}>
                  {key === 'open' ? 'Open work' : key === 'risk' ? 'Upcoming risk' : key === 'changed' ? 'What changed' : key[0].toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
            {tab === 'summary' ? (
              <div className="handover-layout">
                <section className="portal-surface">
                  <h2 className="portal-surface__title">Notes</h2>
                  <form onSubmit={saveDraft}>
                    <textarea className="input" rows={6} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!item.can_edit} />
                    {item.can_edit ? <button type="submit" className="btn btn-secondary" disabled={saving}>Save draft</button> : null}
                  </form>
                </section>
                <aside className="portal-surface">
                  <p>Outgoing: {known(item.outgoing_name)}</p>
                  {item.can_edit ? (
                    <label className="label">Incoming
                      <select className="input" value={incomingUserId} onChange={(event) => setIncomingUserId(event.target.value)}>
                        <option value="">Select from the roster</option>
                        {(item.people || []).map((person) => (
                          <option key={person.user_id} value={person.user_id}>{known(person.name)}</option>
                        ))}
                      </select>
                    </label>
                  ) : <p>Incoming: {known(item.incoming_name)}</p>}
                  <p>Collection: {item.collection_status === 'partial' ? 'Partial' : 'Complete'}</p>
                  {item.can_reassign ? (
                    <form onSubmit={(event) => { event.preventDefault(); void post('reassign', { incoming_user_id: Number(incomingUserId) || 0, reason: reassignReason }, 'Incoming person reassigned. Incidents move only if this acknowledgement reassigns them.'); setReassignReason(''); }}>
                      <label className="label">Lead reassign
                        <select className="input" value={incomingUserId} onChange={(event) => setIncomingUserId(event.target.value)}>
                          {(item.people || []).map((person) => (
                            <option key={person.user_id} value={person.user_id}>{known(person.name)}</option>
                          ))}
                        </select>
                      </label>
                      <input className="input" value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} placeholder="Reason" required />
                      <button type="submit" className="btn btn-secondary" disabled={saving || !reassignReason.trim()}>Reassign incoming</button>
                    </form>
                  ) : null}
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void post('notify', {}, 'Shift notice sent to the incoming and outgoing people. Emails stay off the page.')}>Notify this shift</button>
                  {item.can_submit ? <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void post('submit', {}, 'Submitted. Incoming acknowledgement is now required.')}>Submit</button> : null}
                  {item.can_acknowledge ? (
                    <>
                      <label className="catalog-editor__toggle-label">
                        <input type="checkbox" checked={reassignIncidents} onChange={(event) => setReassignIncidents(event.target.checked)} />
                        <span>Reassign open incidents on this handover to {known(item.incoming_name)}. Status is not changed to Fixed.</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={saving}
                        onClick={() => void post('acknowledge', {
                          expected_revision: item.revision,
                          reviewed_item_ids: Object.entries(reviewed).filter(([, value]) => value).map(([key]) => Number(key)),
                          reasons: Object.fromEntries(Object.entries(reasons).map(([key, value]) => [key, value])),
                          reassign_incidents: reassignIncidents,
                        }, reassignIncidents ? 'Acknowledged. Open incidents were reassigned. Status was not changed to Fixed.' : 'Acknowledged. Incident assignment is unchanged.')}
                      >
                        Acknowledge revision {item.revision}
                      </button>
                    </>
                  ) : null}
                  {item.can_cancel ? (
                    <form onSubmit={(event) => { event.preventDefault(); void post('cancel', { reason: cancelReason }, 'Cancelled. Source work was kept.'); }}>
                      <input className="input" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancel reason" />
                      <button type="submit" className="btn btn-secondary" disabled={saving}>Cancel handover</button>
                    </form>
                  ) : null}
                </aside>
              </div>
            ) : null}
            {tab === 'open' ? <ItemList rows={openWork} empty={item.collection_status === 'partial' ? 'Open work could not be collected.' : 'No matching items as of collection time.'} /> : null}
            {tab === 'risk' ? <ItemList rows={upcoming} empty={item.collection_status === 'partial' ? 'Upcoming risk could not be collected.' : 'No matching items as of collection time.'} /> : null}
            {tab === 'actions' ? (
              <section className="portal-surface">
                <ul>
                  {(item.actions || []).map((row) => (
                    <li key={row.id}>
                      {known(row.title)} · {known(row.owner_name)} · {known(row.status)} {row.carried ? '· carried forward' : ''}
                      {row.status !== 'done' ? (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void post('actions', { id: row.id, status: 'done' }, 'Action marked done.')}>Done</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!item.actions?.length ? <p>No carried-forward actions. Completed work is not kept pending.</p> : null}
                {item.can_edit ? (
                  <form onSubmit={(event) => { event.preventDefault(); void post('actions', { title: actionTitle, owner_name: item.incoming_name, next_action: actionTitle, status: 'open' }, 'Action added.'); setActionTitle(''); }}>
                    <input className="input" value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} placeholder="Next action" />
                    <button type="submit" className="btn btn-secondary" disabled={saving || !actionTitle.trim()}>Add action</button>
                  </form>
                ) : null}
              </section>
            ) : null}
            {tab === 'changed' ? (
              <section className="portal-surface">
                <p>{item.delta?.note || 'Live changes since collection. The snapshot is unchanged.'}</p>
                {(item.delta?.added || []).map((row) => (
                  <p key={`added-${row.source_ref}`}>Added: {known(row.source_ref)} · {known(row.title)}</p>
                ))}
                {(item.delta?.removed || []).map((row) => (
                  <p key={`removed-${row.source_ref}`}>No longer open: {known(row.source_ref)} · {known(row.title)}</p>
                ))}
                {(item.delta?.changed || []).map((row) => (
                  <p key={`changed-${row.source_ref}`}>Changed: {known(row.source_ref)} · {known(row.before)} → {known(row.after)}</p>
                ))}
                {!item.delta?.added?.length && !item.delta?.removed?.length && !item.delta?.changed?.length ? (
                  <p>No live changes since collection.</p>
                ) : null}
              </section>
            ) : null}
            {tab === 'history' ? (
              <section className="portal-surface">
                {(item.revisions || []).map((row) => (
                  <p key={row.revision}>Revision {row.revision} · {known(row.state)} · {row.created_at}</p>
                ))}
                {!item.revisions?.length ? <p>No submitted revisions yet.</p> : null}
                {critical.length ? <p>Critical items stay listed until they are closed in their source records.</p> : null}
              </section>
            ) : null}
          </>
        )}
      </div>
    </DevOpsLayout>
  );
}
