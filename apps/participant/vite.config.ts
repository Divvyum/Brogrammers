import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable, with the app shell cached so My ID and the schedule open offline (plan S1, S7).
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "AURA · Student",
        short_name: "AURA",
        description: "Your hackathon: team, travel, ID, schedule and results",
        start_url: "/",
        display: "standalone",
        background_color: "#eef0fa",
        theme_color: "#5b5cf0",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:3000" } },
  build: { chunkSizeWarningLimit: 1500 },
});
