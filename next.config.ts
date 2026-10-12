import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Paper figures (D23) are hotlinked through the image optimizer and never re-hosted.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "arxiv.org", pathname: "/html/**" },
      { protocol: "https", hostname: "cdn-uploads.huggingface.co", pathname: "/**" },
      { protocol: "https", hostname: "cdn-thumbnails.huggingface.co", pathname: "/**" },
    ],
  },
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
