import Link from 'next/link';
import type { ComponentType } from 'react';

export interface MobileTab {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  active: boolean;
  badge?: string | null;
}

interface MobileTabBarProps {
  tabs: MobileTab[];
  onMore: () => void;
  moreOpen?: boolean;
  MoreIcon: ComponentType<{ className?: string }>;
}

export default function MobileTabBar({ tabs, onMore, moreOpen = false, MoreIcon }: MobileTabBarProps) {
  const anyActive = tabs.some((tab) => tab.active);
  return (
    <nav className="ig-tabbar" aria-label="Main">
      {tabs.map(({ href, label, Icon, active, badge }) => (
        <Link
          key={href}
          href={href}
          className={`ig-tabbar__item${active ? ' ig-tabbar__item--active' : ''}`}
          aria-current={active ? 'page' : undefined}
        >
          <span className="ig-tabbar__icon-wrap">
            <Icon className="ig-tabbar__icon" />
            {badge ? <span className="ig-tabbar__badge">{badge}</span> : null}
          </span>
          <span className="ig-tabbar__label">{label}</span>
        </Link>
      ))}
      <button
        type="button"
        className={`ig-tabbar__item${moreOpen || !anyActive ? ' ig-tabbar__item--active' : ''}`}
        onClick={onMore}
        aria-expanded={moreOpen}
      >
        <span className="ig-tabbar__icon-wrap">
          <MoreIcon className="ig-tabbar__icon" />
        </span>
        <span className="ig-tabbar__label">More</span>
      </button>
    </nav>
  );
}
