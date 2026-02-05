import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

interface Team {
  id: number;
  name: string;
  slug: string;
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
  const { id } = router.query;
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState('member');
  const [adding, setAdding] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

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
        body: JSON.stringify({ user_id: parseInt(addUserId, 10), role: addRole }),
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

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Remove this member from the team?')) return;
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${id}/members/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && typeof id === 'string') fetchTeam(parseInt(id, 10));
    } catch (_) {}
  };

  const memberIds = new Set(members.map(m => m.user_id));
  const availableUsers = users.filter(u => !memberIds.has(u.id));

  if (!id || Array.isArray(id)) return null;

  return (
    <>
      <Head><title>{team?.name ?? 'Team'} - Admin</title></Head>
      <div className="container">
        <div style={{ marginBottom: 24 }}>
          <Link href="/teams">← Teams</Link>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : error && !team ? (
          <div className="card"><div className="error">{error}</div></div>
        ) : team ? (
          <>
            <div className="card">
              <h2 style={{ marginBottom: 8 }}>{team.name}</h2>
              <p style={{ color: '#6b7280', fontSize: 14 }}>Slug: <code>{team.slug}</code></p>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 16 }}>Members</h3>
              {error && <div className="error">{error}</div>}

              <form onSubmit={handleAddMember} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 24 }}>
                <div>
                  <label className="label">Add user</label>
                  <select className="input" value={addUserId} onChange={e => setAddUserId(e.target.value)} style={{ minWidth: 200 }}>
                    <option value="">Select user...</option>
                    {availableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Role</label>
                  <select className="input" value={addRole} onChange={e => setAddRole(e.target.value)} style={{ minWidth: 120 }}>
                    <option value="member">member</option>
                    <option value="lead">lead</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" disabled={!addUserId || adding}>
                  {adding ? 'Adding...' : 'Add'}
                </button>
              </form>

              {members.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No members yet. Add users above.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.id}>
                        <td>{m.username}</td>
                        <td>{m.email}</td>
                        <td>{m.role}</td>
                        <td>
                          <button type="button" className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => handleRemoveMember(m.user_id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
