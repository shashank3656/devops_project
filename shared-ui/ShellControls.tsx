import { useEffect, useState } from 'react';
import { THEME_CHANGE_EVENT, getTheme, openCommandPalette, toggleTheme, type ThemeMode } from './theme';

export function SearchTrigger({ placeholder = 'Search requests, PRs, services…' }: { placeholder?: string }) {
  const [shortcut, setShortcut] = useState('Ctrl K');

  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setShortcut('⌘K');
  }, []);

  return (
    <button type="button" className="ig-search-trigger" onClick={openCommandPalette} aria-label="Open search">
      <svg className="ig-search-trigger__icon" viewBox="0 0 24 24" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <span className="ig-search-trigger__text">{placeholder}</span>
      <kbd className="ig-kbd">{shortcut}</kbd>
    </button>
  );
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    setMode(getTheme());
    const onChange = (event: Event) => setMode((event as CustomEvent<ThemeMode>).detail || getTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="ig-icon-button"
      onClick={() => setMode(toggleTheme())}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {mode === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}

const PIPELINE_STAGES = [
  { env: 'dev', note: 'Build & test' },
  { env: 'uat', note: 'Review & approve' },
  { env: 'prod', note: 'Guarded release' },
];

export function AuthPipeline() {
  return (
    <div className="ig-auth-pipeline" aria-hidden>
      <div className="ig-auth-pipeline__track">
        <span className="ig-auth-pipeline__pulse" />
        <span className="ig-auth-pipeline__pulse ig-auth-pipeline__pulse--late" />
      </div>
      <ol className="ig-auth-pipeline__stages">
        {PIPELINE_STAGES.map((stage) => (
          <li key={stage.env} className="ig-auth-pipeline__stage">
            <span className="ig-auth-pipeline__node" />
            <strong>{stage.env}</strong>
            <span className="ig-auth-pipeline__note">{stage.note}</span>
            <span className="ig-auth-pipeline__status">
              <span className="ig-dot ig-dot--ok" /> healthy
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
