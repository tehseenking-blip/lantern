import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer is a plain single-page app loaded from disk by Electron,
// so assets resolve relatively and nothing is ever fetched from a network.
export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist-renderer",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
  },
});