import { defineConfig, type Plugin, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactPdfWorkerd } from "./server/pdf/vite-plugin-react-pdf-workerd.ts";

/** Restricts plugins to the browser (client) environment. */
function clientOnly(plugins: PluginOption): Plugin[] {
  const flat: unknown[] = Array.isArray(plugins) ? (plugins as unknown[]).flat(5) : [plugins];
  return flat
    .filter((p): p is Plugin => !!p && typeof p === "object" && "name" in p)
    .map((p) => ({ ...p, applyToEnvironment: (env) => env.name === "client" }));
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
  plugins: [
    react(),
    tailwindcss(),
    // Runs worker/index.ts (API + static assets) in workerd for dev/preview and
    // builds it next to the SPA. Config: wrangler.jsonc.
    cloudflare(),
    // Lets @react-pdf/renderer (server-side invoice PDFs) run inside the Worker.
    reactPdfWorkerd(),
    // The service worker belongs to the browser build only.
    ...clientOnly(VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt"],
      manifest: {
        name: "Midnight Invoice",
        short_name: "Midnight Invoice",
        description: "A modern, dark-themed invoice generator",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4000000,
        // Never answer API calls (or llms.txt) with the cached SPA shell.
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/llms\.txt$/, /^\/\.well-known\//],
        runtimeCaching: [
          {
            // API responses carry invoices and are authorised by the workspace
            // token: never cache them (they are also sent with no-store).
            urlPattern: ({ url }) =>
              url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/.well-known/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    })),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
