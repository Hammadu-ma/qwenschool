import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Skip legacy-browser transpilation — smaller, faster-to-parse output.
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          // Core framework: rarely changes, cached long-term by the browser
          // across deploys instead of being re-downloaded with every route.
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js", "@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    // The preview proxy cannot upgrade WebSocket connections, so the HMR
    // client would throw "WebSocket closed without opened" on every load.
    // Disable it — the app serves fine without hot reload in this sandbox.
    hmr: false,
    watch: {
      usePolling: false,
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
  },
});
