import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // the developer's earlier links; resolveJar aliases the other spellings of them as well
  async redirects() {
    return ["/j/support", "/j/demo"].map((source) => ({ source, destination: "/j/support-nearjar", permanent: false }));
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
