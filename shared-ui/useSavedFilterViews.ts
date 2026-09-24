import { useCallback, useEffect, useState } from 'react';
import type { SavedView } from './SavedViews';

type ServerView = {
  id: number;
  name: string;
  scope: string;
  filters: Record<string, unknown>;
};

/**
 * Loads and persists queue filter views on the API while keeping localStorage as offline fallback.
 */
export function useSavedFilterViews<T extends object>({
  apiUrl,
  token,
  scope,
  storageKey,
  portal = 'admin',
}: {
  apiUrl: string;
  token: string | null;
  scope: string;
  storageKey: string;
  portal?: 'admin' | 'devops';
}) {
  const apiBase = `${apiUrl}/api/${portal}/saved-views`;
  const [remoteViews, setRemoteViews] = useState<SavedView<T>[]>([]);
  const [remoteIdsByName, setRemoteIdsByName] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) {
      setRemoteViews([]);
      setRemoteIdsByName({});
      setReady(true);
      return;
    }
    try {
      const res = await fetch(`${apiBase}?scope=${encodeURIComponent(scope)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setReady(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data?.views) ? (data.views as ServerView[]) : [];
      const ids: Record<string, number> = {};
      const views: SavedView<T>[] = rows.map((row) => {
        ids[row.name] = row.id;
        return { name: row.name, filters: (row.filters || {}) as T };
      });
      setRemoteIdsByName(ids);
      setRemoteViews(views);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(views));
      } catch {
        // ignore quota errors
      }
    } finally {
      setReady(true);
    }
  }, [apiBase, token, scope, storageKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveRemote = useCallback(
    async (view: SavedView<T>) => {
      if (!token) return;
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: view.name, scope, filters: view.filters }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.view?.id) {
          setRemoteIdsByName((prev) => ({ ...prev, [view.name]: data.view.id }));
        }
        await refresh();
      }
    },
    [apiBase, token, scope, refresh]
  );

  const deleteRemote = useCallback(
    async (name: string) => {
      if (!token) return;
      const id = remoteIdsByName[name];
      if (!id) return;
      await fetch(`${apiBase}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await refresh();
    },
    [apiBase, token, remoteIdsByName, refresh]
  );

  return { remoteViews, ready, saveRemote, deleteRemote, refresh };
}
