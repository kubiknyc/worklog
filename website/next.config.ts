import type { NextConfig } from "next";

// Security headers for the public site. Kept deliberately framework-safe: the
// CSP sets only `frame-ancestors` (anti-clickjacking) so it can't break
// Next's inline hydration scripts/styles the way a strict script-src would.
// The rest are standard hardening headers.
// Ported from PunchLog's website (PLW/next.config.ts) verbatim.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
