import { resolve } from "node:path";

import { defineConfig } from "vite";

const root = import.meta.dirname;

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    rollupOptions: {
      input: { fixture: resolve(root, "fixture.html") },
    },
  },
});
