/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  serverActions: {
    allowedOrigins: ['elevatetrust.in', 'www.elevatetrust.in', 'localhost:8001'],
  },
};

export default nextConfig;
