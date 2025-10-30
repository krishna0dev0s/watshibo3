/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "randomuser.me",
      },
      {
        protocol: "https",
        hostname: "i.imghippo.com",
      },
    ],
  },
  experimental: {
    serverActions: {
      enabled: true
    }
  },
  turbopack: {},
  output: 'standalone',
};

export default nextConfig;
