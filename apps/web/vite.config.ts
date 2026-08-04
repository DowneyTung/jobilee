import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Required inside Docker: the dev server must accept connections from
    // outside the container, and file watching needs polling on bind mounts.
    host: "0.0.0.0",
    watch: { usePolling: true },
  },
  preview: { port: 5173, host: "0.0.0.0" },
});
