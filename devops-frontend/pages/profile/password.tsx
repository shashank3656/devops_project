import Link from 'next/link';
import ProfileGate from '../../components/ProfileGate';
import { PortalProfileSettings } from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';

export default function ChangePasswordPage() {
  const apiUrl = useApiUrl();

  return (
    <ProfileGate title="Change password">
      {({ user, token, notify, setUser }) => (
        <>
          <header className="portal-page__header">
            <div className="portal-page__header-main">
              <span className="portal-page__eyebrow">Settings</span>
              <h1 className="portal-page__title">Change password</h1>
              <p className="portal-page__subtitle">Update the password used to sign in to this workspace.</p>
            </div>
            <Link href="/profile" className="btn btn-secondary">Back to profile</Link>
          </header>
          <PortalProfileSettings
            apiUrl={apiUrl}
            token={token}
            user={user}
            focus="password"
            onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
            onNotify={notify}
          />
        </>
      )}
    </ProfileGate>
  );
}
