export type RecentService = {
  id: number;
  name: string;
  project?: string;
  environment?: string;
};

const KEY = 'opstrellis-recent-services';

export function readRecentServices(): RecentService[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === 'number' && typeof item.name === 'string').slice(0, 6);
  } catch {
    return [];
  }
}

export function rememberService(item: RecentService) {
  if (!item.id || !item.name.trim()) return;
  const next = [item, ...readRecentServices().filter((saved) => saved.id !== item.id)].slice(0, 6);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The homepage still works if this browser cannot store the list.
  }
}
