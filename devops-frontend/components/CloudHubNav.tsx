import Link from 'next/link';
import { CLOUD_PROVIDER_SEGMENT, providerLabel, type CloudProviderId } from '../lib/cloudProviders';

type HubTab = 'accounts' | 'inventory';

export default function CloudHubNav({
  active,
  provider,
  onProviderChange,
  showAllProvider = false,
}: {
  active: HubTab;
  provider?: CloudProviderId | '';
  onProviderChange?: (provider: CloudProviderId | '') => void;
  showAllProvider?: boolean;
}) {
  const inventoryHref = provider
    ? `/cloud-resources?cloud=${encodeURIComponent(provider)}`
    : '/cloud-resources';

  return (
    <nav className="cloud-hub-nav portal-surface" aria-label="Cloud workspace">
      <div className="cloud-hub-nav__row">
        <div className="cloud-hub-nav__tabs" role="tablist" aria-label="Cloud views">
          <Link
            href="/cloud-accounts"
            className={`cloud-hub-nav__tab${active === 'accounts' ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active === 'accounts'}
          >
            Accounts
          </Link>
          <Link
            href={inventoryHref}
            className={`cloud-hub-nav__tab${active === 'inventory' ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active === 'inventory'}
          >
            Inventory
          </Link>
        </div>
        {onProviderChange ? (
          <div className="cloud-hub-nav__providers" role="group" aria-label="Cloud provider">
            {showAllProvider ? (
              <button
                type="button"
                className={`cloud-hub-nav__pill${provider === '' ? ' is-active' : ''}`}
                onClick={() => onProviderChange('')}
              >
                All clouds
              </button>
            ) : null}
            {CLOUD_PROVIDER_SEGMENT.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                className={`cloud-hub-nav__pill cloud-hub-nav__pill--${option.value}${
                  provider === option.value ? ' is-active' : ''
                }`}
                onClick={() => onProviderChange(option.value as CloudProviderId)}
              >
                {providerLabel(option.value)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
