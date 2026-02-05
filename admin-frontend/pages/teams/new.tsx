import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

export default function NewTeam() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
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
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.team) {
        router.push(`/teams/${data.team.id}`);
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
      <Head><title>Create team - Admin</title></Head>
      <div className="container">
        <div style={{ marginBottom: 24 }}>
          <Link href="/teams">← Teams</Link>
        </div>
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ marginBottom: 24 }}>Create team</h2>
          {error && <div className="error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <label className="label">Team name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Platform Team" style={{ marginBottom: 16 }} />
            <label className="label">Slug (optional, auto-generated from name if empty)</label>
            <input className="input" value={slug} onChange={e => setSlug(e.target.value)} placeholder="platform-team" style={{ marginBottom: 24 }} />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create team'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
