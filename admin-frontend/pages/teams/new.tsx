import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';
import { asRecord, getString } from '../../lib/payload';

export default function NewTeam() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [teamType, setTeamType] = useState<'portal' | 'devops'>('portal');
  const [defaultEnv, setDefaultEnv] = useState('');
  const [defaultCloud, setDefaultCloud] = useState('');
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
          default_env: defaultEnv.trim() || undefined,
          default_cloud: defaultCloud.trim() || undefined,
        }),
      });
      const data = asRecord(await res.json().catch(() => ({})));
      const teamData = asRecord(data.team);
      if (res.ok && typeof teamData.id === 'number') {
        const groupName = getString(teamData.team_type, 'portal') === 'devops' ? 'DevOps team group' : 'Portal team group';
        router.push(`/teams/${teamData.id}?created=1&group=${encodeURIComponent(groupName)}`);
        return;
      }
      setError(getString(data.error, 'Failed to create team'));
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
                  Team slug{' '}
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
                <p style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Group ID is auto-generated as a 12-character lowercase alphanumeric value and used in Git/PR folder paths.
                </p>
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
              <div className="form-group">
                <label className="label" htmlFor="default-env">
                  Default environment{' '}
                  <span className="label-optional">(prefilled when user from this team creates a request)</span>
                </label>
                <select
                  id="default-env"
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
              <div className="form-group">
                <label className="label" htmlFor="default-cloud">
                  Default cloud{' '}
                  <span className="label-optional">(optional)</span>
                </label>
                <select
                  id="default-cloud"
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
