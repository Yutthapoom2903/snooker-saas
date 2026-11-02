import type { NextConfig } from 'next';

const API = process.env.API_ORIGIN ?? 'http://localhost:3001';

const config: NextConfig = {
  // One origin for the browser: the web app proxies the API and uploaded files,
  // so the auth cookie is first-party and a single tunnel URL covers LINE too.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API}/uploads/:path*` },
    ];
  },
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default config;
