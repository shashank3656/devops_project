import Link from 'next/link';
import ProfileGate from '../../components/ProfileGate';
import { PortalProfileSettings } from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';

export default function SignalRoutingPage() {
  const apiUrl = useApiUrl();

  return (
    <ProfileGate title="Signal routing">
      {({ user, token, notify, setUser }) => (
        <>
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Settings</span>
              <h1 className="portal-page__title">Signal routing</h1>
              <p className="portal-page__subtitle">Choose which request events should reach your inbox.</p>
            </div>
            <Link href="/profile" className="btn btn-secondary">Back to profile</Link>
          </header>
          <PortalProfileSettings
            apiUrl={apiUrl}
            token={token}
            user={user}
            focus="notifications"
            onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
            onNotify={notify}
          />
        </>
      )}
    </ProfileGate>
  );
}
