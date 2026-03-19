import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333",
      "/stream": { target: "http://localhost:3333", changeOrigin: true },
      "/assets": "http://localhost:3333",
    },
  },
  build: {
    outDir: "dist",
  },
});
