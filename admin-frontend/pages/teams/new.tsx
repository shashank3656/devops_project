import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

export default function NewTeam() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [teamType, setTeamType] = useState<'portal' | 'devops'>('portal');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/teams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          team_type: teamType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.team) {
        const groupName = (data.team.team_type || 'portal') === 'devops' ? 'DevOps team group' : 'Portal team group';
        router.push(`/teams/${data.team.id}?created=1&group=${encodeURIComponent(groupName)}`);
        return;
      }
      setError(data.error || 'Failed to create team');
    } catch (_) {
      setError('Failed to create team');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Create team - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/teams" className="back-link">
            ← Back to Teams
          </Link>
          <div className="card" style={{ maxWidth: 480 }}>
            <h2 className="card-title">Create team</h2>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="team-name">
                  Team name <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="team-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Platform Team"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="team-slug">
                  Slug{' '}
                  <span className="label-optional">
                    (optional, auto-generated from name if empty)
                  </span>
                </label>
                <input
                  id="team-slug"
                  className="input"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. platform-team"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="team-type">Group type</label>
                <select
                  id="team-type"
                  className="input"
                  value={teamType}
                  onChange={(e) => setTeamType(e.target.value as 'portal' | 'devops')}
                >
                  <option value="portal">Portal team group (developer, lead, manager roles)</option>
                  <option value="devops">DevOps team group</option>
                </select>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ padding: '10px 24px' }}
              >
                {loading ? 'Creating…' : 'Create team'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
