/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume shared packages as TypeScript source (no prebuilt step).
  transpilePackages: ['@nexxore/ui', '@nexxore/sdk'],
  eslint: {
    // Lint is run explicitly in CI as its own step.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
