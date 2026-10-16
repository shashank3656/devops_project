import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { ACCESS_SECTIONS, grantSummary, grantsForTeam, pagesFor, sameGrants, type SectionGrants, type SectionKey } from '../../../lib/accessSections';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

type Team = {
  id: number;
  name: string;
  team_type?: string;
  grants?: Partial<SectionGrants>;
  grants_saved?: boolean;
};

type Person = { id: number; username: string };
type Member = { user_id: number; username: string; role: string };

export default function GroupAccessPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const teamId = Number(router.query.id);
  const [team, setTeam] = useState<Team | null>(null);
  const [draft, setDraft] = useState<SectionGrants>(grantsForTeam({}));
  const [saved, setSaved] = useState<SectionGrants>(grantsForTeam({}));
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [memberRole, setMemberRole] = useState('developer');
  const [defaultEnv, setDefaultEnv] = useState('');
  const [defaultCloud, setDefaultCloud] = useState('');
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!router.isReady || !Number.isFinite(teamId) || teamId <= 0) return;
    let cancel = false;
    fetch(`${apiUrl}/api/admin/users`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) return;
        if (cancel) return;
        const rows = Array.isArray(body?.users) ? body.users : [];
        setPeople(rows.map((account: Person) => ({ id: account.id, username: account.username })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams/${teamId}`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancel) return;
        const detail = body?.team && typeof body.team === 'object' ? body.team as { default_env?: string; default_cloud?: string; team_type?: string } : null;
        if (detail) {
          setDefaultEnv(detail.default_env || '');
          setDefaultCloud(detail.default_cloud || '');
          setMemberRole(detail.team_type === 'devops' ? 'member' : 'developer');
        }
        const rows = Array.isArray(body?.members) ? body.members : [];
        setMembers(rows.map((member: { user_id: number; username: string; role: string }) => ({
          user_id: member.user_id,
          username: member.username,
          role: member.role,
        })));
      })
      .catch(() => undefined);
    fetch(`${apiUrl}/api/admin/teams`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'This group could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const list = Array.isArray(body?.teams) ? body.teams as Team[] : [];
        const found = list.find((item) => item.id === teamId) || null;
        if (!found) {
          setError('This group was not found.');
          return;
        }
        const grants = grantsForTeam(found);
        setTeam(found);
        setDraft(grants);
        setSaved(grants);
        setCustom(Boolean(found.grants_saved));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl, router.isReady, teamId]);

  async function addPerson() {
    if (!team || !personId) return;
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          user_id: Number(personId),
          role: memberRole,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'That person was not added.');
        return;
      }
      const person = people.find((item) => String(item.id) === personId);
      setMembers((current) => [...current, {
        user_id: Number(personId),
        username: person?.username || 'Person',
        role: memberRole,
      }]);
      setPersonId('');
      setNotice('Person added to this group.');
    } catch {
      setError('That person could not be added.');
    } finally {
      setAdding(false);
    }
  }

  async function removePerson(userId: number) {
    if (!team) return;
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members/${userId}`, {
        method: 'DELETE',
        headers: sessionAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'That person was not removed.');
        return;
      }
      setMembers((current) => current.filter((member) => member.user_id !== userId));
    } catch {
      setError('That person could not be removed.');
    }
  }

  async function changeRole(userId: number, role: string) {
    if (!team) return;
    setError('');
    const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
      body: JSON.stringify({ role }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(typeof body?.error === 'string' ? body.error : 'The role was not changed.');
      return;
    }
    setMembers((current) => current.map((member) => (member.user_id === userId ? { ...member, role } : member)));
  }

  async function saveDefaults() {
    if (!team) return;
    setSavingDefaults(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({ default_env: defaultEnv, default_cloud: defaultCloud }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Defaults were not saved.');
        return;
      }
      setNotice('Request defaults saved.');
    } catch {
      setError('Defaults could not be saved.');
    } finally {
      setSavingDefaults(false);
    }
  }

  async function removeGroup() {
    if (!team || !window.confirm(`Delete ${team.name}? People stay, but they leave this group.`)) return;
    setDeleting(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'DELETE',
        headers: sessionAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'The group was not deleted.');
        return;
      }
      await router.push('/portal-access/teams');
    } catch {
      setError('The group could not be deleted.');
    } finally {
      setDeleting(false);
    }
  }

  function toggle(key: SectionKey) {
    setDraft((current) => {
      const on = !current[key];
      const pages = { ...current.pages };
      for (const page of pagesFor(key)) pages[page.key] = on;
      return { ...current, [key]: on, pages };
    });
  }

  function togglePage(section: SectionKey, pageKey: string) {
    setDraft((current) => {
      const pages = { ...current.pages, [pageKey]: !current.pages[pageKey] };
      const on = pagesFor(section).some((page) => pages[page.key]);
      return { ...current, [section]: on, pages };
    });
  }

  async function save() {
    if (!team) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/teams/${team.id}/grants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Sections were not saved.');
        return;
      }
      setSaved(draft);
      setCustom(true);
      setNotice('Sections saved. Members see them the next time they open the portal.');
      setMenuOpen(false);
    } catch {
      setError('Sections could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const roleOptions = team?.team_type === 'devops'
    ? [{ value: 'member', label: 'Member' }, { value: 'lead', label: 'Lead' }]
    : [
      { value: 'developer', label: 'Developer' },
      { value: 'senior_developer', label: 'Senior developer' },
      { value: 'lead', label: 'Lead' },
      { value: 'manager', label: 'Manager' },
    ];
  const available = people.filter((person) => !members.some((member) => member.user_id === person.id));
  const chosen = grantSummary(draft) === 'No sections' ? [] : [grantSummary(draft)];
  const dirty = !sameGrants(draft, saved) || !custom;

  return (
    <>
      <Head>
        <title>{team ? `${team.name} - DevOps` : 'Group - DevOps'}</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>{team?.name || 'Group'}</h1>
              <p>{team ? (team.team_type === 'devops' ? 'DevOps group' : 'Requester group') : 'Choose the sections this group can open.'}</p>
            </div>
            <div className="access-create__end">
              <Link href="/portal-access/teams" className="btn btn-secondary">Back to groups</Link>
              {team ? <button type="button" className="btn btn-secondary" disabled={deleting} onClick={removeGroup}>{deleting ? 'Deleting…' : 'Delete group'}</button> : null}
            </div>
          </header>
          <AccessNav />
          {router.query.people === '0' ? <div className="alert alert-error" role="alert">The group was created, but the people were not added. Add them below.</div> : null}
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading group…</p> : null}
          {!loading && team ? (
            <section className="portal-surface access-form">
              <h2 className="access-form__title">People</h2>
              {members.length === 0 ? <p className="work-empty">No one is in this group yet.</p> : (
                <ul className="access-members">
                  {members.map((member) => (
                    <li key={member.user_id}>
                      <span>{member.username}</span>
                      <select className="input" aria-label={`Role for ${member.username}`} value={member.role} onChange={(event) => changeRole(member.user_id, event.target.value)}>
                        {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <button type="button" className="btn btn-secondary" onClick={() => removePerson(member.user_id)}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
              <label className="label" htmlFor="add-role">Role</label>
              <select id="add-role" className="input" value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <label className="label" htmlFor="add-person">Add someone</label>
              <select id="add-person" className="input" value={personId} onChange={(event) => setPersonId(event.target.value)}>
                <option value="">{available.length ? 'Choose a person' : 'Everyone is already in this group'}</option>
                {available.map((person) => (
                  <option key={person.id} value={person.id}>{person.username}</option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={!personId || adding} onClick={addPerson}>
                {adding ? 'Adding…' : 'Add to group'}
              </button>
            </section>
          ) : null}
          {!loading && team ? (
            <section className="portal-surface access-form">
              <h2 className="access-form__title">Request defaults</h2>
              <p className="access-hint">These prefill the next request someone in this group opens.</p>
              <label className="label" htmlFor="group-env">Environment</label>
              <select id="group-env" className="input" value={defaultEnv} onChange={(event) => setDefaultEnv(event.target.value)}>
                <option value="">None</option>
                <option value="dev">dev</option>
                <option value="stage">stage</option>
                <option value="prod">prod</option>
              </select>
              <label className="label" htmlFor="group-cloud">Cloud</label>
              <select id="group-cloud" className="input" value={defaultCloud} onChange={(event) => setDefaultCloud(event.target.value)}>
                <option value="">None</option>
                <option value="aws">AWS</option>
                <option value="gcp">GCP</option>
                <option value="azure">Azure</option>
              </select>
              <button type="button" className="btn btn-primary" disabled={savingDefaults} onClick={saveDefaults}>
                {savingDefaults ? 'Saving…' : 'Save defaults'}
              </button>
            </section>
          ) : null}
          {!loading && team ? (
            <section className="portal-surface access-form">
              <label className="label" htmlFor="group-sections">Sections</label>
              <button
                id="group-sections"
                type="button"
                className="input access-select"
                aria-expanded={menuOpen}
                aria-haspopup="listbox"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span>{chosen.length ? chosen.join(', ') : 'Choose sections'}</span>
                <span aria-hidden="true">{menuOpen ? '▾' : '▸'}</span>
              </button>
              {menuOpen ? (
                <ul className="access-menu" role="listbox" aria-label="Sections" aria-multiselectable="true">
                  {ACCESS_SECTIONS.map((section) => (
                    <li key={section.key}>
                      <label className={draft[section.key] ? 'access-chip is-on' : 'access-chip'}>
                        <input
                          type="checkbox"
                          checked={draft[section.key]}
                          onChange={() => toggle(section.key)}
                        />
                        {section.label}
                      </label>
                      {draft[section.key] ? (
                        <ul className="access-pages" aria-label={`${section.label} pages`}>
                          {pagesFor(section.key).map((page) => (
                            <li key={page.key}>
                              <label className={draft.pages[page.key] ? 'access-chip is-on' : 'access-chip'}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.pages[page.key])}
                                  onChange={() => togglePage(section.key, page.key)}
                                />
                                {page.label}
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="access-team__save">
                <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
