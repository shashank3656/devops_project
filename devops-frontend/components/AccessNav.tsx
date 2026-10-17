import Link from 'next/link';
import { useRouter } from 'next/router';

const LINKS = [
  { href: '/portal-access', label: 'Overview' },
  { href: '/portal-access/users', label: 'People' },
  { href: '/portal-access/teams', label: 'Groups' },
  { href: '/portal-access/sso', label: 'Sign-in' },
];

export default function AccessNav() {
  const { pathname } = useRouter();
  return (
    <nav className="ops-tabs access-nav" aria-label="Portal access">
      {LINKS.map((link) => {
        const current = link.href === '/portal-access' ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} className={current ? 'is-current' : undefined} aria-current={current ? 'page' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
