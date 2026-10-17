import Link from 'next/link';
import ProfileGate from '../../components/ProfileGate';
import { PortalProfileSettings } from '@infragate/ui';
import { useApiUrl } from '../../context/ApiUrlContext';

export default function DevOpsProfilePage() {
  const apiUrl = useApiUrl();

  return (
    <ProfileGate title="Profile">
      {({ user, token, devopsProfile, teams, notify, setUser }) => {
        const initials = (user.username || 'U').slice(0, 2).toUpperCase();
        return (
          <>
            <header className="portal-page__header">
              <div className="portal-page__header-main">
                <span className="portal-page__eyebrow">Settings</span>
                <h1 className="portal-page__title">Profile settings</h1>
                <p className="portal-page__subtitle">Account security and notifications, plus your DevOps role and team assignments.</p>
              </div>
            </header>
            <nav className="ops-tabs" aria-label="Profile settings">
              <Link href="/profile" className="is-current">Account</Link>
              <Link href="/profile/password">Change password</Link>
              <Link href="/profile/notifications">Signal routing</Link>
              <Link href="/profile/api-keys">API access</Link>
            </nav>

            <section className="portal-surface" id="profile-account">
              <div className="portal-profile-hero">
                <div className="portal-avatar">{initials}</div>
                <div>
                  <h2 className="portal-profile-hero__title">{user.username}</h2>
                  {user.email && <p className="portal-profile-hero__meta">{user.email}</p>}
                  <div className="portal-pill-row">
                    <span className={`portal-badge ${user.verified ? 'portal-badge--success' : 'portal-badge--warning'}`}>
                      {user.verified ? 'Verified' : 'Not verified'}
                    </span>
                    <span className="portal-badge portal-badge--neutral">
                      {devopsProfile?.is_manager ? 'DevOps Manager' : 'DevOps Member'}
                    </span>
                    {devopsProfile?.level ? <span className="portal-pill">{devopsProfile.level}</span> : null}
                    {devopsProfile?.position ? <span className="portal-pill">{devopsProfile.position}</span> : null}
                  </div>
                </div>
              </div>
            </section>

            <div className="ops-actions-3">
              <Link href="/profile/password" className="ops-jump ops-jump--peach">
                <strong>Change password</strong>
                <small>Update the password for this account.</small>
              </Link>
              <Link href="/profile/notifications" className="ops-jump ops-jump--lilac">
                <strong>Signal routing</strong>
                <small>Choose which request events reach your inbox.</small>
              </Link>
              <Link href="/profile/api-keys" className="ops-jump ops-jump--blue">
                <strong>API access</strong>
                <small>Create and revoke programmatic keys.</small>
              </Link>
            </div>

            <section className="portal-grid">
              <article className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Teams</span>
                    <h2 className="portal-surface__title">Assigned squads</h2>
                  </div>
                </div>
                {teams.length === 0 ? (
                  <p className="portal-surface__subtitle">No team assignments yet.</p>
                ) : (
                  <div className="portal-pill-row">
                    {teams.map((team) => (
                      <span key={team.id} className="portal-pill">
                        {team.name}
                      </span>
                    ))}
                  </div>
                )}
              </article>

              <article className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Profile data</span>
                    <h2 className="portal-surface__title">Role details</h2>
                  </div>
                </div>
                <div className="portal-profile-grid">
                  <div className="portal-kv">
                    <span className="portal-kv__label">Role</span>
                    <span className="portal-kv__value">{devopsProfile?.is_manager ? 'Manager' : 'Member'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Level</span>
                    <span className="portal-kv__value">{devopsProfile?.level || '—'}</span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">Onboard date</span>
                    <span className="portal-kv__value">
                      {devopsProfile?.onboard_date ? new Date(devopsProfile.onboard_date).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div className="portal-kv">
                    <span className="portal-kv__label">2FA</span>
                    <span className="portal-kv__value">{user.totp_enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
              </article>
            </section>

            <PortalProfileSettings
              apiUrl={apiUrl}
              token={token}
              user={user}
              focus="account"
              onUserPatch={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
              onNotify={notify}
            />
          </>
        );
      }}
    </ProfileGate>
  );
}
