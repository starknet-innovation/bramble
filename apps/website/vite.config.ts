/** Builds the public Bramble pages without extension or wallet-runtime privileges. */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        docs: `${root}docs/index.html`,
        home: `${root}index.html`,
        support: `${root}support/index.html`,
      },
    },
  },
});
