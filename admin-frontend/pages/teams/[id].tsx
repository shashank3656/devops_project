import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface Team {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
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

export default function TeamDetail() {
  const router = useRouter();
  const { id, created, group } = router.query;
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    if (id && typeof id === 'string') {
      fetchTeam(parseInt(id, 10));
      fetchUsers();
    }
  }, [token, id, router]);

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
      const res = await fetch(`${apiUrl}/api/admin/teams/${teamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.team) {
        setTeam(data.team);
        setMembers(data.members || []);
      } else {
        setError(data.error || 'Team not found');
      }
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
      if (data.users) setUsers(data.users);
    } catch (_) {}
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId || !id) return;
    setAdding(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${id}/members`, {
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
        if (typeof id === 'string') fetchTeam(parseInt(id, 10));
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
    if (selectedUserIds.length === 0 || !id) return;
    setBulkAdding(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${id}/members`, {
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
        if (typeof id === 'string') fetchTeam(parseInt(id, 10));
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
    if (!confirm('Remove this member from the team?')) return;
    try {
      const res = await fetch(
        `${apiUrl}/api/admin/teams/${id}/members/${userId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok && typeof id === 'string')
        fetchTeam(parseInt(id, 10));
    } catch (_) {}
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    if (!id || typeof id !== 'string') return;
    setUpdatingRoleFor(userId);
    setError('');
    try {
      const res = await fetch(
        `${apiUrl}/api/admin/teams/${id}/members/${userId}`,
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

  const handleDeleteTeam = async () => {
    if (!team || !confirm(`Delete team "${team.name}"? This will remove all members. This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/teams');
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

  if (!id || Array.isArray(id)) return null;

  return (
    <>
      <Head>
        <title>{team?.name ?? 'Team'} - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/teams" className="back-link">
            ← Back to Teams
          </Link>

          {created === '1' && group && (
            <div className="alert" role="alert" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', marginBottom: 16 }}>
              Team created successfully. <strong>{team?.name ?? ''}</strong> ({decodeURIComponent(String(group))}).
            </div>
          )}

          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : error && !team ? (
            <div className="card">
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            </div>
          ) : team ? (
            <>
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <h2 className="card-title">{team.name}</h2>
                    <p
                      style={{
                        color: 'var(--color-text-muted)',
                        fontSize: 14,
                      }}
                    >
                      Slug: <code>{team.slug}</code>
                      {(team.team_type === 'devops' || team.team_type === 'portal') && (
                        <span style={{ marginLeft: 12 }}>
                          Group: {team.team_type === 'devops' ? 'DevOps team group' : 'Portal team group'}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={deleting}
                    onClick={handleDeleteTeam}
                  >
                    {deleting ? 'Deleting…' : 'Delete team'}
                  </button>
                </div>
              </div>

              <div className="card">
                <h3 className="card-title">Members</h3>
                {error && (
                  <div className="alert alert-error" role="alert">
                    {error}
                  </div>
                )}

                <div
                  style={{
                    marginBottom: 24,
                    paddingBottom: 24,
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                    Add new member
                  </h4>
                  <p
                    style={{
                      color: 'var(--color-text-muted)',
                      fontSize: 14,
                      marginBottom: 16,
                    }}
                  >
                    Select a user to add to this team. New users can be created from the{' '}
                    <Link href="/users/new">Users</Link> page.
                  </p>
                  <form
                    onSubmit={handleAddMember}
                    style={{
                      display: 'flex',
                      gap: 16,
                      flexWrap: 'wrap',
                      alignItems: 'flex-end',
                    }}
                  >
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
                      <label className="label" htmlFor="add-user">
                        User
                      </label>
                      <select
                        id="add-user"
                        className="input"
                        value={addUserId}
                        onChange={(e) => setAddUserId(e.target.value)}
                        style={{ minWidth: 220 }}
                      >
                        <option value="">Select user…</option>
                        {availableUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.username} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, minWidth: 120 }}>
                      <label className="label" htmlFor="add-role">
                        Role
                      </label>
                      <select
                        id="add-role"
                        className="input"
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                        style={{ minWidth: 140 }}
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
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={!addUserId || adding}
                    >
                      {adding ? 'Adding…' : 'Add member'}
                    </button>
                  </form>

                  {/* Bulk add */}
                  {availableUsers.length > 0 && (
                    <div
                      style={{
                        marginTop: 24,
                        paddingTop: 24,
                        borderTop: '1px solid var(--color-border)',
                      }}
                    >
                      <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                        Bulk add members
                      </h4>
                      <p
                        style={{
                          color: 'var(--color-text-muted)',
                          fontSize: 14,
                          marginBottom: 16,
                        }}
                      >
                        Select multiple users below and add them at once.
                      </p>
                      <form
                        onSubmit={handleBulkAddMembers}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 16,
                        }}
                      >
                        <div
                          style={{
                            maxHeight: 180,
                            overflowY: 'auto',
                            border: '1px solid var(--color-border)',
                            borderRadius: 8,
                            padding: 12,
                          }}
                        >
                          {availableUsers.map((u) => (
                            <label
                              key={u.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '6px 0',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(u.id)}
                                onChange={() => toggleUserSelection(u.id)}
                              />
                              <span>
                                {u.username} <span style={{ color: 'var(--color-text-muted)' }}>({u.email})</span>
                              </span>
                            </label>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
                  )}
                </div>

                {members.length === 0 ? (
                  <div className="empty-state">
                    No members yet. Add users above.
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
                            <td style={{ color: 'var(--color-text-muted)' }}>
                              {m.email}
                            </td>
                            <td>
                              <select
                                className="input"
                                value={m.role}
                                disabled={updatingRoleFor === m.user_id}
                                onChange={(e) =>
                                  handleRoleChange(m.user_id, e.target.value)
                                }
                                style={{
                                  minWidth: 100,
                                  padding: '6px 8px',
                                  fontSize: 13,
                                  textTransform: 'capitalize',
                                }}
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
                                className="btn btn-danger"
                                style={{
                                  padding: '6px 12px',
                                  fontSize: 13,
                                }}
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
              </div>
            </>
          ) : null}
        </div>
      </AdminLayout>
    </>
  );
}
