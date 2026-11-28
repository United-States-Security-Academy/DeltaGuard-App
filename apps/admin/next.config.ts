import type { NextConfig } from 'next';

import { staticSecurityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // No Cache Components / Partial Prerendering: the CSP uses a per-request
  // nonce (src/proxy.ts), which a prerendered static shell can't carry. Every
  // console page is per user anyway.
  cacheComponents: false,
  // No "X-Powered-By: Next.js".
  poweredByHeader: false,
  // Production source maps stay off: no source code or paths in the browser.
  productionBrowserSourceMaps: false,
  async headers() {
    // Static files and anything the proxy doesn't run on; the proxy adds the CSP.
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders().map(([key, value]) => ({ key, value })),
      },
    ];
  },
  // @deltaguard/shared ships TypeScript source, so Next needs to compile it.
  transpilePackages: ['@deltaguard/shared'],
  // CommonJS with dynamic requires: load from node_modules at runtime
  // (timesheet XLSX export) instead of bundling.
  serverExternalPackages: ['exceljs'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
