const defaultOrigins = [
  'chatiq.co.in',
  'www.chatiq.co.in',
  'localhost:3000',
  'localhost:3001',
  '127.0.0.1:3000',
  '127.0.0.1:3001',
  'localhost:8001',
];
const extraOrigins = (process.env.NEXT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      allowedOrigins: [...new Set([...defaultOrigins, ...extraOrigins])],
    },
  },
};

export default nextConfig;
