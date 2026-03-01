import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: path.resolve(__dirname, "../../../dist/dashboard/public"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:9100",
      "/ws": { target: "ws://localhost:9100", ws: true },
    },
  },
});
