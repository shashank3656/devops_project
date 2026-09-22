const path = require('path');
const fs = require('fs');

function sharedUiDir(fromDir) {
  const sibling = path.resolve(fromDir, '../shared-ui');
  if (fs.existsSync(path.join(sibling, 'index.ts'))) return sibling;
  const nested = path.join(fromDir, 'shared-ui');
  if (fs.existsSync(nested)) return nested;
  if (fs.existsSync('/shared-ui')) return '/shared-ui';
  return sibling;
}

function withSharedUi(nextConfig, fromDir) {
  const absAlias = sharedUiDir(fromDir);
  return {
    ...nextConfig,
    transpilePackages: [...(nextConfig.transpilePackages || []), 'shared-ui', '@infragate/ui'],
    experimental: {
      ...(nextConfig.experimental || {}),
      externalDir: true,
    },
    webpack: (config, options) => {
      const reactDir = path.resolve(fromDir, 'node_modules/react');
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        '@infragate/ui': absAlias,
        react: reactDir,
        'react/jsx-runtime': path.join(reactDir, 'jsx-runtime.js'),
        'react/jsx-dev-runtime': path.join(reactDir, 'jsx-dev-runtime.js'),
        'next/link': path.resolve(fromDir, 'node_modules/next/link.js'),
        'next/router': path.resolve(fromDir, 'node_modules/next/router.js'),
      };
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }
      return config;
    },
  };
}

module.exports = { sharedUiDir, withSharedUi };
