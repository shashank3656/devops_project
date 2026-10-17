import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

type Person = { id: number; username: string };
type Group = { id: number; name: string };

export default function EditPersonPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const personId = Number(router.query.id);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [userType, setUserType] = useState('portal_user');
  const [role, setRole] = useState('viewer');
  const [isManager, setIsManager] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [position, setPosition] = useState('');
  const [onboardDate, setOnboardDate] = useState('');
  const [level, setLevel] = useState('L1');
  const [groups, setGroups] = useState<Group[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!router.isReady || !Number.isFinite(personId) || personId <= 0) return;
    let cancel = false;
    const headers = sessionAuthHeaders();
    Promise.all([
      fetch(`${apiUrl}/api/admin/users/${personId}`, { headers }).then((response) => response.json().catch(() => ({}))),
      fetch(`${apiUrl}/api/admin/users`, { headers }).then((response) => response.json().catch(() => ({}))),
    ]).then(([detail, directory]) => {
      if (cancel) return;
      const account = detail?.user;
      if (!account || typeof account.username !== 'string') {
        setError('This person was not found.');
        return;
      }
      const profile = account.devops_profile && typeof account.devops_profile === 'object' ? account.devops_profile : {};
      setUsername(account.username);
      setEmail(typeof account.email === 'string' ? account.email : '');
      setUserType(account.user_type === 'devops_user' ? 'devops_user' : 'portal_user');
      setRole(account.role === 'contributor' ? 'contributor' : 'viewer');
      setIsManager(Boolean(account.user_type === 'devops_user' ? profile.is_manager : account.is_portal_manager));
      setManagerId(account.manager_id ? String(account.manager_id) : '');
      setPosition(typeof profile.position === 'string' ? profile.position : '');
      setOnboardDate(typeof profile.onboard_date === 'string' ? profile.onboard_date.slice(0, 10) : '');
      setLevel(typeof profile.level === 'string' && profile.level ? profile.level : 'L1');
      const memberships = Array.isArray(account.teams) ? account.teams : [];
      setGroups(memberships.map((group: Group) => ({ id: group.id, name: group.name })));
      const rows = Array.isArray(directory?.users) ? directory.users : [];
      setPeople(rows
        .filter((item: Person) => item.id !== personId)
        .map((item: Person) => ({ id: item.id, username: item.username })));
    }).catch(() => {
      if (!cancel) setError('This person could not be loaded.');
    }).finally(() => {
      if (!cancel) setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [apiUrl, personId, router.isReady]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiUrl}/api/admin/users/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sessionAuthHeaders() },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          role,
          user_type: userType,
          is_manager: userType === 'devops_user' ? isManager : undefined,
          is_portal_manager: userType === 'portal_user' ? isManager : undefined,
          manager_id: userType === 'portal_user' && managerId ? Number(managerId) : null,
          position: userType === 'devops_user' ? position.trim() : '',
          onboard_date: userType === 'devops_user' ? onboardDate : '',
          level: userType === 'devops_user' ? level : 'L1',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === 'string' ? body.error : 'Changes were not saved.');
        return;
      }
      setNotice('Saved. Approval level is used the next time a request is assigned.');
    } catch {
      setError('Changes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Head>
        <title>{username ? `${username} - OpsTrellis` : 'Person - OpsTrellis'}</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>{username || 'Person'}</h1>
              <p>Update the account. For a DevOps person, the approval level decides which requests they receive.</p>
            </div>
            <Link href="/portal-access/users" className="btn btn-secondary">Back to people</Link>
          </header>
          <AccessNav />
          {notice ? <div className="alert alert-success" role="status">{notice}</div> : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading person…</p> : null}
          {!loading && username ? (
            <form className="portal-surface access-form" onSubmit={save}>
              <label className="label" htmlFor="edit-username">Username</label>
              <input id="edit-username" className="input" value={username} onChange={(event) => setUsername(event.target.value)} required />
              <label className="label" htmlFor="edit-email">Sign-in email</label>
              <input id="edit-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="off" />
              <label className="label" htmlFor="edit-type">Kind</label>
              <select id="edit-type" className="input" value={userType} onChange={(event) => setUserType(event.target.value)}>
                <option value="portal_user">Requester</option>
                <option value="devops_user">DevOps</option>
              </select>
              <label className="label" htmlFor="edit-role">Can change work</label>
              <select id="edit-role" className="input" value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="viewer">View only</option>
                <option value="contributor">Can raise and update</option>
              </select>
              {userType === 'portal_user' ? (
                <>
                  <label className="label" htmlFor="edit-manager">Approves their requests</label>
                  <select id="edit-manager" className="input" value={managerId} onChange={(event) => setManagerId(event.target.value)}>
                    <option value="">No one yet</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.username}</option>)}
                  </select>
                  <p className="access-hint">Their manager approves first. DevOps approves after that.</p>
                </>
              ) : (
                <>
                  <label className="label" htmlFor="edit-position">Position</label>
                  <input id="edit-position" className="input" value={position} onChange={(event) => setPosition(event.target.value)} />
                  <label className="label" htmlFor="edit-onboard">Onboard date</label>
                  <input id="edit-onboard" className="input" type="date" value={onboardDate} onChange={(event) => setOnboardDate(event.target.value)} />
                  <label className="label" htmlFor="edit-level">Approval level</label>
                  <select id="edit-level" className="input" value={level} onChange={(event) => setLevel(event.target.value)}>
                    <option value="L1">L1 — low</option>
                    <option value="L2">L2 — medium</option>
                    <option value="L3">L3 — high</option>
                    <option value="L4">L4 — critical</option>
                  </select>
                  <p className="access-hint">Low requests go to L1, medium to L2, high to L3, and critical to L4.</p>
                </>
              )}
              <label className="access-chip">
                <input type="checkbox" checked={isManager} onChange={(event) => setIsManager(event.target.checked)} />
                Manager
              </label>
              {groups.length > 0 ? (
                <p className="access-hint">
                  Groups:{' '}
                  {groups.map((group, index) => (
                    <span key={group.id}>
                      {index > 0 ? ', ' : ''}
                      <Link href={`/portal-access/teams/${group.id}`}>{group.name}</Link>
                    </span>
                  ))}
                </p>
              ) : <p className="access-hint">This person is not in a group yet.</p>}
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </form>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
