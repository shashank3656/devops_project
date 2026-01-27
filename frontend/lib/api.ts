// Centralized API configuration
export const getApiUrl = (): string => {
  // In browser, use window.location for same-origin requests
  if (typeof window !== 'undefined') {
    // If running in Docker, use the service name
    // If running locally, use localhost
    return process.env.NEXT_PUBLIC_API_URL || 'http://backend:8080';
  }
  // Server-side rendering fallback
  return process.env.NEXT_PUBLIC_API_URL || 'http://backend:8080';
};

export const API_BASE_URL = getApiUrl();
