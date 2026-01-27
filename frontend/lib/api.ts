// Centralized API configuration
// Note: NEXT_PUBLIC_* variables are baked into the build at build time
// Make sure to rebuild the frontend after changing NEXT_PUBLIC_API_URL in .env
export const getApiUrl = (): string => {
  // NEXT_PUBLIC_API_URL is available at build time and runtime
  // It's baked into the Next.js build, so it will be available in the browser
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (!apiUrl) {
    console.warn('NEXT_PUBLIC_API_URL is not set, falling back to localhost:8080');
    return 'http://localhost:8080';
  }
  
  return apiUrl;
};

export const API_BASE_URL = getApiUrl();
