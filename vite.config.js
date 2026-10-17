import { resolve } from "node:path";
import { defineConfig } from "vite";
import { userscriptPlugin } from "./scripts/userscript-dev-plugin.mjs";

export default defineConfig({
  plugins: [userscriptPlugin()],
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        userscriptsSetup: resolve(
          import.meta.dirname,
          "userscripts-setup.html",
        ),
        userscriptsSync: resolve(import.meta.dirname, "userscripts-sync.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        support: resolve(import.meta.dirname, "support.html"),
        control: resolve(import.meta.dirname, "control.html"),
        maintenance: resolve(import.meta.dirname, "maintenance.html"),
        notFound: resolve(import.meta.dirname, "404.html"),
      },
    },
  },
});
