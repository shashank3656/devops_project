import Link from 'next/link';
import { useRouter } from 'next/router';
import type { ReactNode } from 'react';

const LINKS = [
  { href: '/iam', label: 'Overview' },
  { href: '/iam/request', label: 'Request' },
  { href: '/iam/requests', label: 'My requests' },
  { href: '/iam/approvals', label: 'Approvals' },
  { href: '/iam/permissions', label: 'Permissions' },
  { href: '/iam/audit', label: 'Audit' },
  { href: '/iam/policy', label: 'Policy' },
];

export default function IamFrame({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  const { pathname } = useRouter();
  return (
    <div className="work-page iam-page">
      <header className="work-page__head">
        <div>
          <p className="ops-kicker">Infrastructure · IAM</p>
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
      </header>
      <nav className="iam-tabs" aria-label="IAM">
        {LINKS.map((link) => {
          const current = pathname === link.href;
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
