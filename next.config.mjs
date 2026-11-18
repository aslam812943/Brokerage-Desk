import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** @type {import('next').NextConfig} */

// Short commit SHA baked in at build time, shown at the bottom of the app —
// lets us tell which deploy is actually live instead of guessing from
// timing. Vercel always sets VERCEL_GIT_COMMIT_SHA during builds; falls back
// to reading git directly for local dev/builds.
function buildVersion() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Content-Security-Policy prevents XSS-escalation, external script injection,
// and data exfiltration via injected fetch/XHR calls.
// unsafe-inline is required for Next.js hydration scripts and React inline styles.
// unsafe-eval is required for Next.js dev HMR; consider removing in prod if using nonces.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy",   value: CSP },
];

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_BUILD_VERSION: buildVersion(),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
