import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Installable PWA with the whole app shell cached, so the scanner opens with
    // no network after one online visit (plan A1, A13).
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // public/manifest.webmanifest
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Roster photos (generated avatars in the seed, Cloudinary in production).
            urlPattern: ({ url }) => url.hostname === "api.dicebear.com" || url.hostname === "res.cloudinary.com",
            handler: "CacheFirst",
            options: { cacheName: "photos", expiration: { maxEntries: 1000, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fonts" },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://localhost:3000" },
  },
});
