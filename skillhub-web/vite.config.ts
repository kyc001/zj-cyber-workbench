import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3011,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_SKILL_HUB_API_URL || "http://127.0.0.1:8011",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_SKILL_HUB_API_URL || "http://127.0.0.1:8011",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
