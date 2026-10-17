import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import AccessFilters from '../../components/AccessFilters';
import AccessNav from '../../components/AccessNav';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { sessionAuthHeaders } from '../../lib/portalAccess';

export default function PortalAccessPage() {
  const apiUrl = useApiUrl();
  const [people, setPeople] = useState<number | null>(null);
  const [groups, setGroups] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [step, setStep] = useState('all');
  const [focus, setFocus] = useState('all');

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
  }, [apiUrl]);

  const count = (value: number | null, noun: string) => (value === null ? noun : `${value} ${noun}`);
  const needle = query.trim().toLowerCase();
  const areas = [
    { id: 'people', href: '/portal-access/users', title: '1. People', tone: 'ops-jump ops-jump--mint', copy: `${count(people, 'accounts')} can sign in. Start here when someone is new.`, topic: 'accounts' },
    { id: 'groups', href: '/portal-access/teams', title: '2. Groups', tone: 'ops-jump ops-jump--lilac', copy: `${count(groups, 'groups')} decide the sections. A person sees the sections on their groups.`, topic: 'sections' },
    { id: 'signin', href: '/portal-access/sso', title: '3. Sign-in', tone: 'ops-jump ops-jump--blue', copy: 'Password, directory, or both. Directory secrets stay on the API host.', topic: 'directory' },
  ].filter((area) => {
    if (step !== 'all' && area.id !== step) return false;
    if (focus === 'accounts' && area.id !== 'people') return false;
    if (focus === 'sections' && area.id !== 'groups') return false;
    if (focus === 'directory' && area.id !== 'signin') return false;
    if (!needle) return true;
    return `${area.title} ${area.copy}`.toLowerCase().includes(needle);
  });

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
          <AccessFilters
            query={query}
            onQuery={setQuery}
            placeholder="Search people, groups, or sign-in"
            kind={step}
            onKind={setStep}
            kindLabel="Step"
            kindOptions={[
              { value: 'all', label: 'All steps' },
              { value: 'people', label: 'People' },
              { value: 'groups', label: 'Groups' },
              { value: 'signin', label: 'Sign-in' },
            ]}
            extra={focus}
            onExtra={setFocus}
            extraLabel="About"
            extraOptions={[
              { value: 'all', label: 'Anything' },
              { value: 'accounts', label: 'Accounts' },
              { value: 'sections', label: 'Sections' },
              { value: 'directory', label: 'Directory' },
            ]}
          />
          {areas.length === 0 ? <p className="work-empty">Nothing matches this search.</p> : (
            <section className="ops-actions-3" aria-label="Access steps">
              {areas.map((area) => (
                <Link key={area.id} href={area.href} className={area.tone}>
                  <strong>{area.title}</strong>
                  <small>{area.copy}</small>
                </Link>
              ))}
            </section>
          )}
        </div>
      </DevOpsLayout>
    </>
  );
}
