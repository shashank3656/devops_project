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
        <div className="portal-page portal-page--narrow">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">People</span>
              <h1 className="portal-page__title">Create team</h1>
              <p className="portal-page__subtitle">
                Add a portal or DevOps group. A unique group ID is generated for Git and PR folder paths.
              </p>
            </div>
            <Link href="/teams" className="btn btn-secondary">
              Back to teams
            </Link>
          </div>
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          <form className="portal-surface" onSubmit={handleSubmit}>
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
                <span className="label-optional">(optional, auto-generated from name if empty)</span>
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
              <label className="label" htmlFor="team-type">
                Group type
              </label>
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
                <span className="label-optional">(prefilled when this team creates a request)</span>
              </label>
              <select id="default-env" className="input" value={defaultEnv} onChange={(e) => setDefaultEnv(e.target.value)}>
                <option value="">None</option>
                <option value="dev">dev</option>
                <option value="stage">stage</option>
                <option value="prod">prod</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label" htmlFor="default-cloud">
                Default cloud <span className="label-optional">(optional)</span>
              </label>
              <select id="default-cloud" className="input" value={defaultCloud} onChange={(e) => setDefaultCloud(e.target.value)}>
                <option value="">None</option>
                <option value="aws">AWS</option>
                <option value="gcp">GCP</option>
                <option value="azure">Azure</option>
              </select>
            </div>
            <div className="portal-page__actions" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Creating…' : 'Create team'}
              </button>
            </div>
          </form>
        </div>
      </AdminLayout>
    </>
  );
}
