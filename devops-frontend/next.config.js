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
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
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
