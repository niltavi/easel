import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {defineConfig} from "vitest/config";
import {VitePWA} from "vite-plugin-pwa";
import {siteHtml} from "./scripts/site-html.ts";

const apiTarget = process.env.EASEL_API ?? "http://localhost:8787";

export default defineConfig({
  build: {rollupOptions: {input: ["index.html", "zh/index.html", "app/index.html"]}},
  plugins: [
    siteHtml(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Easel",
        short_name: "Easel",
        description: "A personal whiteboard that works offline",
        lang: "en",
        display: "standalone",
        id: "/",
        start_url: "/app",
        background_color: "#F5F1E6",
        theme_color: "#F5F1E6",
        icons: [
          {src: "icon-192.png", sizes: "192x192", type: "image/png"},
          {src: "icon-512.png", sizes: "512x512", type: "image/png"},
          {src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable"},
        ],
      },
      workbox: {
        // Precache the whole app shell; the Chinese handwriting font has many chunks, so cache those on demand.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        globIgnores: ["fonts/Xiaolai/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/app/index.html",
        navigateFallbackAllowlist: [/^\/(?:zh\/)?app(?:\/|\?|$)/],
        runtimeCaching: [
          {
            urlPattern: ({url}) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: {cacheName: "easel-fonts", expiration: {maxEntries: 400}},
          },
        ],
      },
    }),
  ],
  server: {proxy: {"/api": apiTarget}},
  preview: {proxy: {"/api": apiTarget}},
  test: {environment: "node", include: ["tests/**/*.test.ts"]},
});
