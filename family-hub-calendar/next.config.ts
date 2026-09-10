import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  env: {
    // Baked into the client bundle so the kiosk can tell whether it has gone
    // stale against a newer deploy. Vercel sets VERCEL_GIT_COMMIT_SHA; local
    // builds fall back to a timestamp so the mechanism is exercised in dev.
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.BUILD_ID ?? String(Date.now()),
  },
};

export default nextConfig;
