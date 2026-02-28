import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

interface Team {
  id: number;
  name: string;
  slug: string;
  application_id: string;
  created_at: string;
  created_by: number | null;
}

export default function TeamsList() {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTeams();
    // If we landed here after deleting from team detail page, show success
    if (router.query.deleted === '1') {
      setSuccessMessage('Successfully deleted the group.');
      setError('');
      setTimeout(() => setSuccessMessage(''), 4000);
    }
  }, [router]);

  const fetchTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTeams(Array.isArray(data.teams) ? data.teams : []);
        setError('');
      } else {
        setError(data.error || 'Failed to load teams');
      }
    } catch (_) {
      setError('Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeam = async (t: Team) => {
    if (!confirm(`Delete team "${t.name}"? This will remove all members. This cannot be undone.`)) return;
    setDeletingId(t.id);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTeams((prev) => prev.filter((x) => x.id !== t.id));
        setSuccessMessage('Successfully deleted the group.');
        setError('');
        setTimeout(() => setSuccessMessage(''), 4000);
      } else {
        setError(data.error || 'Failed to delete team');
      }
    } catch (_) {
      setError('Failed to delete team');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Head>
        <title>Teams - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Teams</span>
              <h1 className="portal-page__title">Team Management</h1>
              <p className="portal-page__subtitle">
                Create new teams, inspect membership entry points, and remove unused groups from the platform.
              </p>
            </div>
            <Link href="/teams/new" className="btn btn-primary">
              Create team
            </Link>
          </div>

          <div className="portal-surface portal-surface--table">
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="alert alert-info" role="alert" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #a7f3d0', margin: 24 }}>
                {successMessage}
              </div>
            )}
            {loading ? (
              <div className="empty-state" style={{ padding: 24 }}>Loading teams...</div>
            ) : teams.length === 0 ? (
              <div className="empty-state">
                <p>No teams are onboarded yet.</p>
                <p style={{ marginTop: 8 }}>
                  <Link href="/teams/new" className="btn btn-primary" style={{ marginTop: 8 }}>
                    Create your first team
                  </Link>
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Group ID</th>
                      <th>Slug</th>
                      <th>Created</th>
                      <th style={{ width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/teams/${t.id}`} style={{ fontWeight: 500 }}>
                            {t.name}
                          </Link>
                        </td>
                        <td>
                          <code>{t.application_id || 'Pending'}</code>
                        </td>
                        <td>
                          <code>{t.slug}</code>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                          {new Date(t.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div className="portal-page__actions">
                            <Link
                              href={`/teams/${t.id}`}
                              className="btn btn-secondary"
                              style={{ padding: '8px 14px', fontSize: 13 }}
                            >
                              Manage members
                            </Link>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '8px 14px', fontSize: 13 }}
                              disabled={deletingId === t.id}
                              onClick={() => handleDeleteTeam(t)}
                              title="Delete team"
                            >
                              {deletingId === t.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
