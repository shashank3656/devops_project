import Link from 'next/link';

type DeliveryHubTab = 'repos' | 'pulls' | 'pipelines';

export default function DeliveryHubNav({ active }: { active: DeliveryHubTab }) {
  const tabs: { id: DeliveryHubTab; href: string; label: string }[] = [
    { id: 'repos', href: '/deploy-intelligence', label: 'Repositories' },
    { id: 'pulls', href: '/pull-requests', label: 'Pull requests' },
    { id: 'pipelines', href: '/pipelines', label: 'Pipelines' },
  ];
  return (
    <nav className="delivery-hub" aria-label="Delivery">
      <div className="delivery-hub__tabs" role="tablist" aria-label="Delivery views">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={`delivery-hub__tab${active === tab.id ? ' is-active' : ''}`}
            role="tab"
            aria-selected={active === tab.id}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
