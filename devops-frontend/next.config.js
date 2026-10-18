const fs = require('fs');
const path = require('path');

function sharedUiHelper() {
  const nested = path.join(__dirname, 'shared-ui', 'next.cjs');
  if (fs.existsSync(nested)) return nested;
  const parent = path.join(__dirname, '..', 'shared-ui', 'next.cjs');
  if (fs.existsSync(parent)) return parent;
  return '/shared-ui/next.cjs';
}

const { withSharedUi } = require(sharedUiHelper());

function loadConfigEnvHelper() {
  const parent = path.join(__dirname, '..', 'shared-ui', 'load-config-env.cjs');
  if (fs.existsSync(parent)) return parent;
  const nested = path.join(__dirname, 'shared-ui', 'load-config-env.cjs');
  if (fs.existsSync(nested)) return nested;
  return '';
}

const loadConfigEnvPath = loadConfigEnvHelper();
if (loadConfigEnvPath) {
  require(loadConfigEnvPath).loadConfigEnv(__dirname);
}

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
      "manifest-src 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: '/gitops', destination: '/gitops-projects', permanent: false },
      { source: '/deployments', destination: '/promotions', permanent: false },
    ];
  },
};

module.exports = withSharedUi(nextConfig, __dirname);
