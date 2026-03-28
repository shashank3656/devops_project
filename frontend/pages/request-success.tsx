import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';

export default function RequestSuccess() {
  const router = useRouter();
  const { id, team, group, type } = router.query;
  const ticketId = id ? String(id) : '';
  const teamName = team ? String(team) : '';
  const groupName = group ? String(group) : '';
  const requestType = type ? String(type).trim().toLowerCase() : '';
  const isIamFlow = requestType === 'iam';

  return (
    <>
      <Head>
        <title>{isIamFlow ? 'Access Request Sent - SetuOps' : 'Request Sent - SetuOps'}</title>
      </Head>
      <div style={{ minHeight: '100vh', padding: '40px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 480, width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
              {isIamFlow ? 'Access request sent successfully' : 'Request sent successfully'}
            </h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 15 }}>
              {isIamFlow ? 'Your access request is now in the review flow.' : 'Your request is now in the review flow.'}
            </p>
          </div>
          <div style={{ background: 'var(--bg-gray-100)', borderRadius: 8, padding: 20, marginBottom: 24 }}>
            {ticketId && (
              <p style={{ marginBottom: 8, fontSize: 15 }}>
                <strong>{isIamFlow ? 'Access request #' : 'Request #'}</strong>: <code style={{ background: 'var(--color-surface)', padding: '2px 8px', borderRadius: 4 }}>#{ticketId}</code>
              </p>
            )}
            {teamName && (
              <p style={{ marginBottom: groupName ? 8 : 0, fontSize: 15 }}>
                <strong>Team:</strong> {teamName}
              </p>
            )}
            {groupName && (
              <p style={{ margin: 0, fontSize: 15 }}>
                <strong>Group:</strong> {groupName}
              </p>
            )}
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, margin: '0 0 20px' }}>
            {isIamFlow
              ? 'Open My Requests any time to check approval progress, comments, or next steps for this access change.'
              : 'Open My Requests any time to check review progress, comments, or next steps.'}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/history" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Open My Requests
            </Link>
            <Link href="/home" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
