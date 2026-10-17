import { ReactNode, useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from './DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { DEVOPS_SITE_NAME } from '../lib/site';
import { asRecord } from '../lib/payload';
import { buildPortalApiUrl, portalFetch, type PortalProfileAccount } from '@infragate/ui';

const DEVOPS_TOKEN_KEY = 'devops_token';

export interface DevopsTeam {
  id: number;
  name: string;
  slug: string;
  team_type?: string;
}

export interface DevopsProfile {
  is_manager: boolean;
  level?: string;
  position?: string;
  onboard_date?: string;
}

export default function ProfileGate({
  title,
  children,
}: {
  title: string;
  children: (ctx: {
    user: PortalProfileAccount;
    token: string;
    devopsProfile: DevopsProfile | null;
    teams: DevopsTeam[];
    notify: (message: string, kind: 'success' | 'error') => void;
    setUser: (updater: (prev: PortalProfileAccount | null) => PortalProfileAccount | null) => void;
  }) => ReactNode;
}) {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [user, setUser] = useState<PortalProfileAccount | null>(null);
  const [devopsProfile, setDevopsProfile] = useState<DevopsProfile | null>(null);
  const [teams, setTeams] = useState<DevopsTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error'>('success');
  const [token, setToken] = useState<string | null>(null);

  const notify = useCallback((message: string, kind: 'success' | 'error') => {
    setNotice(message);
    setNoticeKind(kind);
    setTimeout(() => setNotice(''), kind === 'error' ? 8000 : 5000);
  }, []);

  useEffect(() => {
    const sessionToken = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!sessionToken) {
      router.replace('/login');
      return;
    }
    setToken(sessionToken);
    setLoading(true);
    portalFetch(buildPortalApiUrl(apiUrl, '/api/me'), { token: sessionToken })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace('/login');
          return null;
        }
        return response.json().catch(() => ({}));
      })
      .then((rawData) => {
        const data = asRecord(rawData);
        const nextUser = data.user;
        if (nextUser && typeof nextUser === 'object') {
          setUser(nextUser as PortalProfileAccount);
        }
        const dp = data.devops_profile;
        if (dp && typeof dp === 'object') {
          setDevopsProfile(dp as DevopsProfile);
        }
        setTeams(Array.isArray(data.teams) ? (data.teams as DevopsTeam[]) : []);
      })
      .catch(() => notify('Failed to load profile', 'error'))
      .finally(() => setLoading(false));
  }, [apiUrl, notify, router]);

  return (
    <DevOpsLayout>
      <Head>
        <title>{title} - {DEVOPS_SITE_NAME}</title>
      </Head>
      <div className="portal-page portal-page--narrow">
        {notice ? (
          <div className={`alert ${noticeKind === 'error' ? 'alert-error' : 'alert-success'}`} role="status">
            {notice}
          </div>
        ) : null}
        {loading ? (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>Loading profile...</p>
            </div>
          </section>
        ) : user && token ? (
          children({ user, token, devopsProfile, teams, notify, setUser })
        ) : (
          <section className="portal-surface">
            <div className="portal-empty">
              <p>{notice || 'Could not load profile.'}</p>
            </div>
          </section>
        )}
      </div>
    </DevOpsLayout>
  );
}
