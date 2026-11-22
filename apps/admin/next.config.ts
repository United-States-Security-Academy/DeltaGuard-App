import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
