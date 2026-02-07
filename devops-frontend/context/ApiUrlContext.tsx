import React, { createContext, useContext, useEffect, useState } from 'react';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const ApiUrlContext = createContext<string>(DEFAULT_API_URL);

export function ApiUrlProvider({ children }: { children: React.ReactNode }) {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.apiUrl) setApiUrl(data.apiUrl);
      })
      .catch(() => {});
  }, []);

  return <ApiUrlContext.Provider value={apiUrl}>{children}</ApiUrlContext.Provider>;
}

export function useApiUrl() {
  return useContext(ApiUrlContext);
}
