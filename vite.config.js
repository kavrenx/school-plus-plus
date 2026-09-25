import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        support: resolve(import.meta.dirname, "support.html"),
        control: resolve(import.meta.dirname, "control.html"),
      },
    },
  },
});
