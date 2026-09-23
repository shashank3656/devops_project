import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Returns the backend API URL from the server environment at request time.
 * Keys are read dynamically so Next.js does not inline the build-time value.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const env = process.env as Record<string, string | undefined>;
  const keys = ['BACKEND_API_URL', 'API_URL', 'NEXT_PUBLIC_API_URL'];
  const runtimeUrl = keys.map((key) => (env[key] || '').trim()).find(Boolean);
  const apiUrl = runtimeUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  res.status(200).json({ apiUrl: apiUrl.replace(/\/+$/, '') });
}
