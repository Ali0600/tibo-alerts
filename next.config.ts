import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.TIBO_RUNTIME === 'node'
    ? { output: 'standalone' as const }
    : {}),
  poweredByHeader: false,
  turbopack: {
    resolveAlias: {
      '@runtime':
        process.env.TIBO_RUNTIME === 'node'
          ? './runtime/node.ts'
          : './runtime/cloudflare.ts',
    },
  },
};

export default nextConfig;
