import type { NextConfig } from "next";

// Tarayıcı API'ye aynı origin üzerinden (/api/...) gider; cookie'ler bu sayede
// SameSite=Lax ile sorunsuz çalışır. Not: rewrite hedefi build sırasında sabitlenir.
const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
