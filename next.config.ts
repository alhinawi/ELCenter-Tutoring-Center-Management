import type { NextConfig } from "next";
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  ...(process.env.ELCENTER_DEV_API
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: "http://127.0.0.1:8788/api/:path*",
            },
          ];
        },
      }
    : {}),
};
export default config;
