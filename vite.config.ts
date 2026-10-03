import { resolve } from "node:path";

import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        fixture: resolve(root, "fixture.html"),
        hover: resolve(root, "hover.html"),
        gallery: resolve(root, "gallery.html"),
        index: resolve(root, "index.html"),
      },
    },
  },
});
