import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';

const LINKS = [
  { href: '/iam', label: 'Cloud access' },
  { href: '/iam/request', label: 'Request access' },
  { href: '/iam/requests', label: 'My requests' },
  { href: '/iam/approvals', label: 'Approvals' },
  { href: '/iam/permissions', label: 'My permissions' },
  { href: '/iam/audit', label: 'Audit' },
  { href: '/iam/policy', label: 'Policy' },
];

export default function IamFrame({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  const { pathname } = useRouter();
  return (
    <div className="work-page">
      <header className="work-page__head">
        <div>
          <p className="ops-kicker">Infrastructure · IAM</p>
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
      </header>
      <nav className="access-nav" aria-label="Cloud access">
        {LINKS.map((link) => {
          const current = link.href === '/iam' ? pathname === '/iam' : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link key={link.href} href={link.href} className={current ? 'is-current' : undefined} aria-current={current ? 'page' : undefined}>
              {link.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
