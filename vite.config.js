import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "frontend",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      manifest: {
        name: "ニコニコXブラウザ",
        short_name: "NicoX",
        description: "ニコニコ弾幕をX.comで楽しむブラウザ",
        theme_color: "#1da1f2",
        background_color: "#000000",
        display: "standalone",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
});
