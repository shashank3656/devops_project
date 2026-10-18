import { NextResponse, type NextRequest } from 'next/server';

function apiOrigin(): string {
  const raw = process.env.BACKEND_API_URL || process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || '';
  try {
    return raw ? new URL(raw).origin : '';
  } catch {
    return '';
  }
}

function contentSecurityPolicy(nonce: string): string {
  const connect = ["'self'"];
  const origin = apiOrigin();
  if (origin) connect.push(origin);
  if (process.env.NODE_ENV !== 'production') {
    connect.push('http://127.0.0.1:8080', 'http://localhost:8080');
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "manifest-src 'self'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|theme-boot.js|logo.svg|manifest.json|robots.txt|sitemap.xml|favicon.ico).*)'],
};
