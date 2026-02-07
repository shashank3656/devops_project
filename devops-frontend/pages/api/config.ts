import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Returns the backend API URL from the server environment.
 * This allows the DevOps frontend to use the container's NEXT_PUBLIC_API_URL at runtime
 * (set by docker-compose env_file / environment) so it connects to the same backend as other frontends.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  res.status(200).json({ apiUrl: apiUrl.replace(/\/$/, '') });
}
