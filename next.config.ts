import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side only secrets are read in server modules; nothing here inlines them.
  reactStrictMode: true,
  poweredByHeader: false,
  // Lint runs as its own CI step (`npm run lint`), configured in eslint.config.mjs.
  experimental: {
    // Uploaded images are validated server-side before they are stored; only
    // local/object-storage origins are ever rendered.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
