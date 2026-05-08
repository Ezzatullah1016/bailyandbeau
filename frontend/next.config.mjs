import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI output unless DSN is configured
  silent: !process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Disable source map upload during local dev (no auth token needed)
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
