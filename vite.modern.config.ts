import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: "./wrangler.modern.jsonc",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@modern": fileURLToPath(new URL("./src/modern", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-modern",
    emptyOutDir: true,
  },
});
