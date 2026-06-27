import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Bypasses ngrok free-tier browser interstitial for all responses,
          // including the VRM binary fetched by Three.js GLTFLoader via XHR
          { key: "ngrok-skip-browser-warning", value: "ngrok-skip-browser-warning" },
        ],
      },
    ];
  },
};

export default nextConfig;
