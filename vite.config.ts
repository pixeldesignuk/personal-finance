import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "web",
  // .env lives at the repo root (shared with the server), not in web/ — load
  // VITE_* vars (e.g. VITE_BRANDFETCH_CLIENT_ID) from there.
  envDir: "..",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
