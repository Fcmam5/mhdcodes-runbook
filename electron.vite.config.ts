import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preload scripts must be CommonJS.
    build: { rolldownOptions: { output: { format: "cjs" } } },
  },
  renderer: {
    plugins: [svelte({ configFile: false }), tailwindcss()],
    // Loaded from disk, not over a network, so one big chunk costs nothing worth
    // splitting for (xterm and CodeMirror are most of it, and both are needed at once).
    build: { minify: true, chunkSizeWarningLimit: 1500 },
  },
});
