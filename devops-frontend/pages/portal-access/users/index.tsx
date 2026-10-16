import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AccessFilters from '../../../components/AccessFilters';
import AccessNav from '../../../components/AccessNav';
import DevOpsLayout from '../../../components/DevOpsLayout';
import { useApiUrl } from '../../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../../lib/portalAccess';

type Account = {
  id: number;
  username: string;
  role?: string;
  user_type?: string;
  verified?: boolean;
  level?: string;
};

export default function PortalUsersPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const [users, setUsers] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [access, setAccess] = useState('all');

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/admin/users`, { headers: sessionAuthHeaders() })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'People could not be loaded.');
        return body;
      })
      .then((body) => {
        if (cancel) return;
        const rows = Array.isArray(body?.users) ? body.users : [];
        setUsers(rows.map((account: Account & { devops_profile?: { level?: string } }) => ({
          id: account.id,
          username: account.username,
          role: account.role,
          user_type: account.user_type,
          verified: account.verified,
          level: account.user_type === 'devops_user' ? (account.devops_profile?.level || 'L1') : '',
        })));
      })
      .catch((err: Error) => {
        if (!cancel) setError(err.message);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [apiUrl]);

  const needle = query.trim().toLowerCase();
  const visible = users.filter((account) => {
    if (kind === 'devops' && account.user_type !== 'devops_user') return false;
    if (kind === 'portal' && account.user_type === 'devops_user') return false;
    if (access === 'change' && account.role !== 'contributor') return false;
    if (access === 'view' && account.role === 'contributor') return false;
    if (!needle) return true;
    return account.username.toLowerCase().includes(needle);
  });

  return (
    <>
      <Head>
        <title>People - DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>People</h1>
              <p>These accounts can sign in. A group, not this list, decides which sections they see.</p>
            </div>
            <Link href="/portal-access/users/new" className="btn btn-primary">Add person</Link>
          </header>
          <AccessNav />
          <AccessFilters
            query={query}
            onQuery={setQuery}
            placeholder="Search by name"
            kind={kind}
            onKind={setKind}
            kindLabel="Kind"
            kindOptions={[
              { value: 'all', label: 'All kinds' },
              { value: 'portal', label: 'Requester' },
              { value: 'devops', label: 'DevOps' },
            ]}
            extra={access}
            onExtra={setAccess}
            extraLabel="Can change work"
            extraOptions={[
              { value: 'all', label: 'Anyone' },
              { value: 'view', label: 'View only' },
              { value: 'change', label: 'Can raise and update' },
            ]}
          />
          {router.query.added === '1' ? (
            <div className="alert alert-success" role="status">
              {router.query.mailed === '1'
                ? 'Account created. A sign-in email was sent with their username and the sign-in link.'
                : 'Account created. The sign-in email was not sent. Mail is not configured, or the mail server refused it.'}
            </div>
          ) : null}
          {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          {loading ? <p className="work-empty">Loading people…</p> : null}
          {!loading && !error && users.length === 0 ? <p className="work-empty">No accounts yet. Add a person to get started.</p> : null}
          {!loading && users.length > 0 && visible.length === 0 ? <p className="work-empty">No people match this search.</p> : null}
          {!loading && visible.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Approval level</th>
                    <th>Can change work</th>
                    <th>Ready to sign in</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((account) => (
                    <tr key={account.id}>
                      <td><Link href={`/portal-access/users/${account.id}`}>{account.username}</Link></td>
                      <td>{account.user_type === 'devops_user' ? 'DevOps' : 'Requester'}</td>
                      <td>{account.level || '—'}</td>
                      <td>{account.role === 'contributor' ? 'Yes' : 'View only'}</td>
                      <td>{account.verified ? 'Yes' : 'Not yet'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </DevOpsLayout>
    </>
  );
}
