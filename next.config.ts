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
        /*
          DELIVERY VARIANTS OF THE APPROVED ARTWORK.

          Files under `public/` are served with `Cache-Control: public,
          max-age=0`, so the hero photograph and the logo were revalidated on
          every navigation. These variants are generated once and their names
          carry the width and the format, so different artwork is a different
          URL — safe to cache for a year, immutably.

          Scoped to `brand/opt/` only. The approved originals stay revalidated,
          because the owner may legitimately replace one at the same path.
        */
        source: "/brand/opt/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
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
