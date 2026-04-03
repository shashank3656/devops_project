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
      <div className="request-success-shell">
        <div className="request-success-card">
          <div className="request-success-hero">
            <div className="request-success-hero__mark" aria-hidden="true">✓</div>
            <h1 className="request-success-hero__title">
              {isIamFlow ? 'Access request sent successfully' : 'Request sent successfully'}
            </h1>
            <p className="request-success-hero__subtitle">
              {isIamFlow ? 'Your access request is now in the review flow.' : 'Your request is now in the review flow.'}
            </p>
          </div>
          <div className="request-success-summary">
            {ticketId && (
              <div className="request-success-summary__row">
                <span className="request-success-summary__label">{isIamFlow ? 'Access request #' : 'Request #'}</span>
                <code className="request-success-summary__code">#{ticketId}</code>
              </div>
            )}
            {teamName && (
              <div className="request-success-summary__row">
                <span className="request-success-summary__label">Team</span>
                <span className="request-success-summary__value">{teamName}</span>
              </div>
            )}
            {groupName && (
              <div className="request-success-summary__row">
                <span className="request-success-summary__label">Group</span>
                <span className="request-success-summary__value">{groupName}</span>
              </div>
            )}
          </div>
          <p className="request-success-copy">
            {isIamFlow
              ? 'Open My Requests any time to check approval progress, comments, or next steps for this access change.'
              : 'Open My Requests any time to check review progress, comments, or next steps.'}
          </p>
          <div className="request-success-actions">
            <Link href="/history" className="btn btn-primary request-success-actions__btn">
              Open My Requests
            </Link>
            <Link href="/home" className="btn btn-secondary request-success-actions__btn">
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
