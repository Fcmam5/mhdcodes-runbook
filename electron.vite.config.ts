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
    build: { minify: true },
  },
});
