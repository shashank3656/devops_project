import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AccessNav from '../../components/AccessNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

export default function PortalAccessPage() {
  const apiUrl = useApiUrl();
  const [people, setPeople] = useState<number | null>(null);
  const [groups, setGroups] = useState<number | null>(null);
  const [accessRequests, setAccessRequests] = useState<{ id: number; username: string; team?: string; project?: string; access_needed?: string; reason?: string; created_at?: string }[]>([]);

  useEffect(() => {
    const headers = sessionAuthHeaders();
    fetch(`${apiUrl}/api/admin/users`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setPeople(Array.isArray(body?.users) ? body.users.length : null))
      .catch(() => setPeople(null));
    fetch(`${apiUrl}/api/admin/teams`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setGroups(Array.isArray(body?.teams) ? body.teams.length : null))
      .catch(() => setGroups(null));
    fetch(`${apiUrl}/api/admin/access-requests`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => setAccessRequests(Array.isArray(body?.requests) ? body.requests : []))
      .catch(() => setAccessRequests([]));
  }, [apiUrl]);

  const count = (value: number | null, noun: string) => (value === null ? noun : `${value} ${noun}`);
  const areas = [
    { id: 'people', href: '/portal-access/users', title: '1. People', tone: 'ops-jump ops-jump--mint', copy: `${count(people, 'accounts')} can sign in. Start here when someone is new.` },
    { id: 'groups', href: '/portal-access/teams', title: '2. Groups', tone: 'ops-jump ops-jump--lilac', copy: `${count(groups, 'groups')} decide the sections. A person sees the sections on their groups.` },
    { id: 'signin', href: '/portal-access/sso', title: '3. Sign-in', tone: 'ops-jump ops-jump--blue', copy: 'Password, directory, or both. Directory secrets stay on the API host.' },
  ];

  return (
    <>
      <Head>
        <title>Portal Access - OpsTrellis</title>
      </Head>
      <DevOpsLayout>
        <div className="work-page">
          <header className="work-page__head">
            <div>
              <p className="ops-kicker">Portal Access</p>
              <h1>Who can open what</h1>
              <p>Add a person, put them in a group, and the group chooses the menu they see. An admin still sees every section.</p>
            </div>
          </header>
          <AccessNav />
          <section className="ops-actions-3" aria-label="Access steps">
              {areas.map((area) => (
                <Link key={area.id} href={area.href} className={area.tone}>
                  <strong>{area.title}</strong>
                  <small>{area.copy}</small>
                </Link>
              ))}
            </section>
          <section className="ops-card" aria-label="Access requests">
            <div className="ops-card__head">
              <h2>Access requests</h2>
              <span>{accessRequests.length ? `${accessRequests.length} waiting` : 'None waiting'}</span>
            </div>
            <p>These come from the login form. They are not sign-ups. Add the person under People, then put them in a group.</p>
            {accessRequests.length ? (
              <ul>
                {accessRequests.map((item) => (
                  <li key={item.id}>
                    <strong>{item.username}</strong>
                    {' · '}
                    {[item.team, item.project, item.access_needed].filter(Boolean).join(' · ') || 'No extra detail'}
                    {item.reason ? <div>{item.reason}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No pending access requests.</p>
            )}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
