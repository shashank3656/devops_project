import Link from 'next/link';
import { useRouter } from 'next/router';

const TABS = [
  { href: '/approval-center', label: 'Queue' },
  { href: '/gate-approvals', label: 'History' },
  { href: '/gate-policies', label: 'Rules' },
  { href: '/approval-sla', label: 'Timing' },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function ApprovalsSectionNav() {
  const router = useRouter();

  return (
    <nav className="ig-k8s-tabs approvals-section-nav" aria-label="Approvals sections">
      {TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className={isActive(router.pathname, tab.href) ? 'is-active' : ''}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
