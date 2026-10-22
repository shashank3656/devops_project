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

const baseHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const filePolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

const fileHeaders = [
  ...baseHeaders,
  { key: 'Content-Security-Policy', value: filePolicy },
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
          ...baseHeaders,
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          ...fileHeaders,
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/theme-boot.js',
        headers: fileHeaders,
      },
      {
        source: '/logo.svg',
        headers: fileHeaders,
      },
      {
        source: '/manifest.json',
        headers: [
          ...fileHeaders,
          { key: 'Cache-Control', value: 'public, max-age=86400' },
        ],
      },
      {
        source: '/robots.txt',
        headers: fileHeaders,
      },
      {
        source: '/sitemap.xml',
        headers: fileHeaders,
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
