import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';
const TIMEZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

type HandoverRow = {
  id: number;
  team_id: number;
  team_name: string;
  project_id: number;
  timezone: string;
  shift_date: string;
  outgoing_name: string;
  incoming_name: string;
  state: string;
  collection_status: string;
  critical_count: number;
  freshness: string;
  outgoing_user_id: number;
  incoming_user_id: number;
};

type Summary = {
  awaiting_acknowledgement: number;
  overdue: number;
  critical_open_items: number;
  missing_owners: number;
};

type TeamOption = { id: number; name: string };

function known(value: string | undefined): string {
  return (value || '').trim() || 'Unknown';
}

function stateLabel(state: string): string {
  if (state === 'draft') return 'Draft';
  if (state === 'submitted') return 'Submitted';
  if (state === 'acknowledged') return 'Acknowledged';
  if (state === 'cancelled') return 'Cancelled';
  return known(state);
}

export default function OnCallHandoversPage() {
  const apiUrl = useApiUrl();
  const [items, setItems] = useState<HandoverRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ awaiting_acknowledgement: 0, overdue: 0, critical_open_items: 0, missing_owners: 0 });
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState('');
  const [state, setState] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${apiUrl}/api/devops/my-teams`, { headers }).then((res) => res.json().catch(() => ({}))).then((data) => {
      const rows = Array.isArray(data?.teams) ? data.teams : [];
      setTeams(rows.map((row: { id?: number; name?: string }) => ({ id: Number(row.id) || 0, name: known(row.name) })).filter((row: TeamOption) => row.id > 0));
    }).catch(() => undefined);
  }, [apiUrl]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (teamId) params.set('team_id', teamId);
    if (state) params.set('state', state);
    fetch(`${apiUrl}/api/oncall/handovers${params.toString() ? `?${params}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Handovers could not be loaded.');
          return;
        }
        setError('');
        setItems(Array.isArray(data.handovers) ? data.handovers : []);
        setSummary({
          awaiting_acknowledgement: Number(data.summary?.awaiting_acknowledgement) || 0,
          overdue: Number(data.summary?.overdue) || 0,
          critical_open_items: Number(data.summary?.critical_open_items) || 0,
          missing_owners: Number(data.summary?.missing_owners) || 0,
        });
      })
      .catch(() => setError('Handovers could not be loaded.'))
      .finally(() => setLoading(false));
  }, [apiUrl, teamId, state, refresh]);

  const visible = useMemo(() => items, [items]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    setSaving(true);
    setNote('');
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/oncall/handovers/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ team_id: teamId ? Number(teamId) : 0, timezone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The draft could not be generated.');
        return;
      }
      setNote('Draft generated from the current roster, including approved covers. Missing sources stay Partial.');
      setRefresh((value) => value + 1);
    } catch {
      setError('The draft could not be generated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DevOpsLayout>
      <Head><title>On-call handovers</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Handovers</h1>
            <p className="portal-page__subtitle">Incoming responders get a reviewed snapshot of open work. Acknowledgement does not reassign incidents. Empty collection is Partial, never “nothing to hand over.”</p>
          </div>
          <div className="portal-page__actions">
            <Link href="/on-call" className="btn btn-secondary">Roster</Link>
          </div>
        </div>
        {error ? (
          <div className="alert alert-error" role="alert">
            {error}{' '}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh((value) => value + 1)}>Retry</button>
          </div>
        ) : null}
        {note ? <div className="alert alert-success">{note}</div> : null}

        <section className="portal-surface">
          <div className="portal-pill-row">
            <span className="portal-pill">Awaiting acknowledgement {summary.awaiting_acknowledgement}</span>
            <span className="portal-pill">Overdue {summary.overdue}</span>
            <span className="portal-pill">Critical open items {summary.critical_open_items}</span>
            <span className="portal-pill">Missing owners {summary.missing_owners}</span>
          </div>
        </section>

        <section className="portal-surface">
          <form className="oncall-filters" onSubmit={generate}>
            <label>
              Team
              <select className="input" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">All visible teams</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              State
              <select className="input" value={state} onChange={(event) => setState(event.target.value)}>
                <option value="">All states</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            </label>
            <label>
              Timezone
              <select className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            <div className="oncall-filters__actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Generating…' : 'Generate draft'}</button>
            </div>
          </form>
          <p className="access-hint">A shift ends at 00:00 in the selected timezone. Generate uses the roster and approved covers. Manual notes stay separate from collected facts.</p>
        </section>

        <section className="portal-surface portal-surface--table">
          {loading ? <div className="empty-state">Loading handovers…</div> : null}
          {!loading && !visible.length ? <div className="empty-state">No matching handovers as of now. Generate a draft for the current shift boundary.</div> : null}
          {!loading && visible.length ? (
            <div className="table-wrap">
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Team</th>
                    <th>Outgoing</th>
                    <th>Incoming</th>
                    <th>Critical</th>
                    <th>Freshness</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td>{row.shift_date} · {row.timezone}</td>
                      <td>{known(row.team_name)}</td>
                      <td>{known(row.outgoing_name)}</td>
                      <td>{known(row.incoming_name)}</td>
                      <td>{row.critical_count}</td>
                      <td>{known(row.freshness)}</td>
                      <td>
                        <span className="portal-pill">{stateLabel(row.state)}</span>
                        {row.collection_status === 'partial' ? <span className="portal-pill">Partial</span> : null}
                      </td>
                      <td><Link href={`/on-call/handovers/${row.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
