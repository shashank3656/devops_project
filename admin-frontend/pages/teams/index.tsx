import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

interface Team {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  created_by: number | null;
}

export default function TeamsList() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTeams();
  }, [router]);

  const fetchTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.teams) setTeams(data.teams);
      else setError(data.error || 'Failed to load teams');
    } catch (_) {
      setError('Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    router.push('/login');
  };

  return (
    <>
      <Head><title>Teams - Admin</title></Head>
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 28 }}>Teams</h1>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link href="/teams/new"><span className="btn btn-primary">Create team</span></Link>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="card">
          {error && <div className="error">{error}</div>}
          {loading ? (
            <p>Loading teams...</p>
          ) : teams.length === 0 ? (
            <p style={{ color: '#6b7280' }}>No teams yet. Create a team to get started.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teams.map(t => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td><code>{t.slug}</code></td>
                    <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td>
                      <Link href={`/teams/${t.id}`}><span className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }}>Manage members</span></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
