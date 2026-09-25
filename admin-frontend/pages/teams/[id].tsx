import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface Team {
  id: number;
  name: string;
  slug: string;
  application_id: string;
  team_type?: string;
  default_env?: string;
  default_cloud?: string;
  created_at: string;
}

interface Member {
  id: number;
  team_id: number;
  user_id: number;
  role: string;
  username: string;
  email: string;
}

interface User {
  id: number;
  username: string;
  email: string;
}

function parsePositiveIntParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export default function TeamDetail() {
  const router = useRouter();
  const { id, created, group } = router.query;
  const routeTeamId = useMemo(() => parsePositiveIntParam(id), [id]);
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [adding, setAdding] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingRoleFor, setUpdatingRoleFor] = useState<number | null>(null);
  const [defaultEnv, setDefaultEnv] = useState('');
  const [defaultCloud, setDefaultCloud] = useState('');
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [memberNotice, setMemberNotice] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    if (routeTeamId) {
      fetchTeam(routeTeamId);
      void fetchUsers();
    } else {
      setLoading(false);
      setTeam(null);
      setError('Team not found');
    }
  }, [token, routeTeamId, router]);

  useEffect(() => {
    if (team?.team_type === 'portal' && !['developer', 'senior_developer', 'lead', 'manager'].includes(addRole)) {
      setAddRole('developer');
    } else if (team?.team_type === 'devops' && !['member', 'lead'].includes(addRole)) {
      setAddRole('member');
    }
  }, [team?.team_type]);

  const fetchTeam = async (teamId: number) => {
    setLoading(true);
    setError('');
    try {
      const teamsRes = await fetch(`${apiUrl}/api/admin/teams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (teamsRes.status === 401 || teamsRes.status === 403) {
        router.replace('/login');
        return;
      }
      const teamsData = await teamsRes.json().catch(() => ({}));
      const teams = Array.isArray(teamsData?.teams) ? teamsData.teams : [];
      const matchedTeam = teams.find((entry: { id?: unknown }) => Number(entry?.id) === teamId);
      if (!matchedTeam?.id) {
        setError('Team not found');
        setTeam(null);
        setMembers([]);
        return;
      }
      const detailRes = await fetch(`${apiUrl}/api/admin/teams/${matchedTeam.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (detailRes.status === 401 || detailRes.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok || !data.team) {
        setError(data.error || 'Team not found');
        setTeam(null);
        setMembers([]);
        return;
      }
      setTeam(data.team);
      setMembers(Array.isArray(data.members) ? data.members : []);
      setDefaultEnv(data.team.default_env || '');
      setDefaultCloud(data.team.default_cloud || '');
    } catch (_) {
      setError('Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (_) {}
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId || !team?.id) return;
    setAdding(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: parseInt(addUserId, 10),
          role: addRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAddUserId('');
        setMemberNotice('Member added.');
        window.setTimeout(() => setMemberNotice(''), 4000);
        fetchTeam(team.id);
      } else {
        setError(data.error || 'Failed to add member');
      }
    } catch (_) {
      setError('Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const handleBulkAddMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserIds.length === 0 || !team?.id) return;
    setBulkAdding(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${team.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_ids: selectedUserIds,
          role: addRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSelectedUserIds([]);
        fetchTeam(team.id);
        const addedCount = Array.isArray(data.added) ? data.added.length : 1;
        const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
        if (failedCount > 0) {
          setError(`Added ${addedCount}, failed: ${failedCount} (maybe already members)`);
        }
      } else {
        setError(data.error || 'Failed to add members');
      }
    } catch (_) {
      setError('Failed to add members');
    } finally {
      setBulkAdding(false);
    }
  };

  const toggleUserSelection = (userId: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleRemoveMember = async (userId: number) => {
    if (!team?.id || !confirm('Remove this member from the team?')) return;
    try {
      const res = await fetch(
        `${apiUrl}/api/admin/teams/${team.id}/members/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) fetchTeam(team.id);
    } catch (_) {}
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    if (!team?.id) return;
    setUpdatingRoleFor(userId);
    setError('');
    try {
      const res = await fetch(
        `${apiUrl}/api/admin/teams/${team.id}/members/${userId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: newRole }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === userId ? { ...m, role: newRole } : m
          )
        );
      } else {
        setError(data.error || 'Failed to update role');
      }
    } catch (_) {
      setError('Failed to update role');
    } finally {
      setUpdatingRoleFor(null);
    }
  };

  const handleSaveDefaults = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team?.id) return;
    setSavingDefaults(true);
    setError('');
    setDefaultsSaved(false);
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ default_env: defaultEnv, default_cloud: defaultCloud }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTeam((prev) => prev ? { ...prev, default_env: defaultEnv, default_cloud: defaultCloud } : null);
        setDefaultsSaved(true);
        setTimeout(() => setDefaultsSaved(false), 3000);
      } else {
        setError(data.error || 'Failed to save team settings');
      }
    } catch (_) {
      setError('Failed to save team settings');
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!team || !confirm(`Delete team "${team.name}"? This will remove all members. This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${team.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/teams?deleted=1');
      } else {
        setError(data.error || 'Failed to delete team');
      }
    } catch (_) {
      setError('Failed to delete team');
    } finally {
      setDeleting(false);
    }
  };

  const memberIds = new Set(members.map((m) => m.user_id));
  const availableUsers = users.filter((u) => !memberIds.has(u.id));

  if (!routeTeamId) return null;

  return (
    <>
      <Head>
        <title>{team?.name ?? 'Team'} - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          {loading ? (
            <div className="admin-queue-state">
              <div className="admin-queue-state__spinner" aria-hidden="true" />
              <p className="admin-queue-state__title">Loading team</p>
            </div>
          ) : error && !team ? (
            <div className="portal-surface">
              <div className="alert alert-error" role="alert">
                {error}
              </div>
              <Link href="/teams" className="btn btn-secondary" style={{ marginTop: 16 }}>
                Back to teams
              </Link>
            </div>
          ) : team ? (
            <>
              <div className="portal-page__header">
                <div>
                  <span className="portal-page__eyebrow">People</span>
                  <h1 className="portal-page__title">{team.name}</h1>
                  <p className="portal-page__subtitle admin-team-detail__meta">
                    Group ID <code>{team.application_id || 'Pending'}</code>
                    <span className="admin-team-detail__meta-sep">
                      Slug <code>{team.slug}</code>
                    </span>
                    {(team.team_type === 'devops' || team.team_type === 'portal') && (
                      <span className="admin-team-detail__meta-sep">
                        {team.team_type === 'devops' ? 'DevOps group' : 'Portal group'}
                      </span>
                    )}
                  </p>
                </div>
                <div className="portal-page__actions">
                  <Link href="/teams" className="btn btn-secondary">
                    All teams
                  </Link>
                  <button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDeleteTeam}>
                    {deleting ? 'Deleting…' : 'Delete team'}
                  </button>
                </div>
              </div>

              {created === '1' && group ? (
                <div className="alert alert-success admin-team-detail__success-alert" role="status">
                  Team created. <strong>{team.name}</strong> ({decodeURIComponent(String(group))}).
                </div>
              ) : null}

              <section className="portal-surface admin-team-detail__card">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Defaults</span>
                    <h2 className="portal-surface__title">Request defaults</h2>
                    <p className="portal-surface__subtitle admin-team-detail__copy">
                      Prefill environment and cloud when someone from this team opens a new request.
                    </p>
                  </div>
                </div>
                <p className="admin-team-detail__copy">
                  Default environment and cloud are prefilled when a user from this team creates a request.
                </p>
                <form onSubmit={handleSaveDefaults} className="admin-team-detail__inline-form">
                  <div className="form-group admin-team-detail__field admin-team-detail__field--compact">
                    <label className="label" htmlFor="team-default-env">Default environment</label>
                    <select
                      id="team-default-env"
                      className="input"
                      value={defaultEnv}
                      onChange={(e) => setDefaultEnv(e.target.value)}
                    >
                      <option value="">None</option>
                      <option value="dev">dev</option>
                      <option value="stage">stage</option>
                      <option value="prod">prod</option>
                    </select>
                  </div>
                  <div className="form-group admin-team-detail__field admin-team-detail__field--compact">
                    <label className="label" htmlFor="team-default-cloud">Default cloud</label>
                    <select
                      id="team-default-cloud"
                      className="input"
                      value={defaultCloud}
                      onChange={(e) => setDefaultCloud(e.target.value)}
                    >
                      <option value="">None</option>
                      <option value="aws">AWS</option>
                      <option value="gcp">GCP</option>
                      <option value="azure">Azure</option>
                    </select>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={savingDefaults}>
                    {savingDefaults ? 'Saving…' : 'Save'}
                  </button>
                  {defaultsSaved ? <span className="admin-team-detail__saved">Saved.</span> : null}
                </form>
              </section>

              <section className="portal-surface portal-surface--table admin-team-detail__card">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Membership</span>
                    <h2 className="portal-surface__title">Members</h2>
                    <p className="portal-surface__subtitle admin-team-detail__copy">
                      Add portal users from the list below, or{' '}
                      <Link href="/users/new">create a user</Link> first if they are not in SetuOps yet.
                    </p>
                  </div>
                </div>
                {error ? (
                  <div className="alert alert-error" role="alert">
                    {error}
                  </div>
                ) : null}
                {memberNotice ? (
                  <div className="alert alert-success" role="status">
                    {memberNotice}
                  </div>
                ) : null}

                <div className="admin-team-detail__section">
                  <h3 className="admin-team-detail__subheading">Add one member</h3>
                  <form onSubmit={handleAddMember} className="admin-team-detail__inline-form">
                    <div className="form-group admin-team-detail__field admin-team-detail__field--user">
                      <label className="label" htmlFor="add-user">
                        User
                      </label>
                      <select
                        id="add-user"
                        className="input"
                        value={addUserId}
                        onChange={(e) => setAddUserId(e.target.value)}
                      >
                        <option value="">Select user…</option>
                        {availableUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.username} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group admin-team-detail__field admin-team-detail__field--role">
                      <label className="label" htmlFor="add-role">
                        Role
                      </label>
                      <select
                        id="add-role"
                        className="input"
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                      >
                        {team.team_type === 'portal' ? (
                          <>
                            <option value="developer">developer</option>
                            <option value="senior_developer">senior developer</option>
                            <option value="lead">lead</option>
                            <option value="manager">manager</option>
                          </>
                        ) : (
                          <>
                            <option value="member">member</option>
                            <option value="lead">lead</option>
                          </>
                        )}
                      </select>
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={!addUserId || adding || availableUsers.length === 0}>
                      {adding ? 'Adding…' : 'Add member'}
                    </button>
                  </form>
                  {availableUsers.length === 0 ? (
                    <div className="empty-state admin-user-edit__empty-inline" style={{ marginTop: 12 }}>
                      Everyone in the directory is already on this team, or no users exist yet.{' '}
                      <Link href="/users/new">Add a user</Link>
                    </div>
                  ) : null}

                  {availableUsers.length > 0 ? (
                    <div className="admin-team-detail__bulk">
                      <h3 className="admin-team-detail__subheading">Add several at once</h3>
                      <p className="admin-team-detail__copy">
                        Select multiple users below and add them at once.
                      </p>
                      <form onSubmit={handleBulkAddMembers} className="admin-team-detail__bulk-form">
                        <div className="admin-team-detail__bulk-list">
                          {availableUsers.map((u) => (
                            <label
                              key={u.id}
                              className="admin-team-detail__bulk-item"
                            >
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(u.id)}
                                onChange={() => toggleUserSelection(u.id)}
                              />
                              <span>
                                {u.username} <span className="admin-team-detail__minor">({u.email})</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="admin-team-detail__bulk-actions">
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={selectedUserIds.length === 0 || bulkAdding}
                          >
                            {bulkAdding ? 'Adding…' : `Add selected (${selectedUserIds.length})`}
                          </button>
                          {selectedUserIds.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setSelectedUserIds([])}
                            >
                              Clear selection
                            </button>
                          )}
                        </div>
                      </form>
                    </div>
                  ) : null}
                </div>

                {members.length === 0 ? (
                  <div className="empty-state">
                    <p>No members yet.</p>
                    <p style={{ marginTop: 8 }}>
                      <Link href="/users/new" className="btn btn-secondary btn-sm">
                        Create user
                      </Link>
                    </p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Username</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th style={{ width: 100 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m) => (
                          <tr key={m.id}>
                            <td>{m.username}</td>
                            <td className="admin-team-detail__minor">
                              {m.email}
                            </td>
                            <td>
                              <select
                                className="input admin-team-detail__member-role"
                                value={m.role}
                                disabled={updatingRoleFor === m.user_id}
                                onChange={(e) =>
                                  handleRoleChange(m.user_id, e.target.value)
                                }
                                aria-label={`Role for ${m.username}`}
                              >
                                {team.team_type === 'portal' ? (
                                  <>
                                    <option value="developer">developer</option>
                                    <option value="senior_developer">senior developer</option>
                                    <option value="lead">lead</option>
                                    <option value="manager">manager</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="member">member</option>
                                    <option value="lead">lead</option>
                                  </>
                                )}
                              </select>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-danger admin-team-detail__remove-btn"
                                onClick={() =>
                                  handleRemoveMember(m.user_id)
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </AdminLayout>
    </>
  );
}
