import Link from 'next/link';

type DeliveryHubTab = 'repos' | 'pipelines' | 'previews';

export default function DeliveryHubNav({ active }: { active: DeliveryHubTab }) {
  const tabs: { id: DeliveryHubTab; href: string; label: string }[] = [
    { id: 'repos', href: '/deploy-intelligence', label: 'Repositories' },
    { id: 'pipelines', href: '/pipelines', label: 'Pipelines' },
    { id: 'previews', href: '/previews', label: 'Previews' },
  ];
  return (
    <nav className="cloud-hub-nav portal-surface" aria-label="Delivery workspace">
      <div className="cloud-hub-nav__row">
        <div className="cloud-hub-nav__tabs" role="tablist" aria-label="Delivery views">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              className={`cloud-hub-nav__tab${active === tab.id ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active === tab.id}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
