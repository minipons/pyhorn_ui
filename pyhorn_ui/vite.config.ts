import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 1420,
    allowedHosts: ["gdb-mcb.local"],
    proxy: {
      "/simulate": "http://127.0.0.1:8765",
      "/fs": "http://127.0.0.1:8765",
    },
  },
  clearScreen: false,
});
