/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/deepfake',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
