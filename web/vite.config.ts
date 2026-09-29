import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = fileURLToPath(new URL(".", import.meta.url));

// The canvas ships inside the npm package as static files. Nothing here is a runtime dependency.
export default defineConfig({
  root: here,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    // The PDF reader worker (about 1.3 MB) loads only when an invoice is added, never on page load.
    chunkSizeWarningLimit: 1400,
    rollupOptions: { output: { entryFileNames: "assets/app.js", chunkFileNames: "assets/[name].js", assetFileNames: "assets/[name][extname]" } },
  },
  worker: { format: "es" },
  server: { port: 43391, proxy: { "/api": "http://127.0.0.1:43400" } },
});
