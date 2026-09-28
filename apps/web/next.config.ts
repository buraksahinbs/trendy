import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Tarayıcı API'ye aynı origin üzerinden (/api/...) gider; cookie'ler bu sayede
// SameSite=Lax ile sorunsuz çalışır. Not: rewrite hedefi build sırasında sabitlenir.
const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Docker imajı için bağımsız (standalone) çıktı; monorepo kökünden dosya izlenir.
  ...(process.env.NEXT_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
      }
    : {}),
  reactStrictMode: true,
  // Geliştirme rozeti kenar çubuğundaki "Ayarlar" bağlantısının üstüne binmesin.
  devIndicators: { position: "bottom-right" },
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
