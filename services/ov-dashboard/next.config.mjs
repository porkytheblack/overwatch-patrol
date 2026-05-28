/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // `@overwatch/agent` is a source-only workspace package (no dist build),
  // so Next needs to compile its TypeScript through SWC like first-party
  // src. `glove-voice` ships ESM with AudioWorklet bits — listing it here
  // avoids module-resolution edge cases when webpack treats published ESM
  // as external.
  transpilePackages: ['@overwatch/agent', 'glove-voice'],
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
  async rewrites() {
    const api = process.env.OV_API_URL ?? 'http://ov-api:3000';
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/ws', destination: `${api}/ws` },
    ];
  },
};

export default nextConfig;
