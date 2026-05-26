/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
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
