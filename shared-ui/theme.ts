export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'opstrellis-theme';
export const THEME_CHANGE_EVENT = 'opstrellis:theme-change';
export const OPEN_PALETTE_EVENT = 'opstrellis:open-palette';

export function getTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(mode: ThemeMode = getTheme()): ThemeMode {
  if (typeof document === 'undefined') return mode;
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.colorScheme = mode;
  return mode;
}

export function setTheme(mode: ThemeMode): ThemeMode {
  if (typeof window === 'undefined') return mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Private mode or storage disabled: still apply for this page view.
  }
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_CHANGE_EVENT, { detail: mode }));
  return mode;
}

export function toggleTheme(): ThemeMode {
  return setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function openCommandPalette(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
