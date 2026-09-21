import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The playground mounts the desktop app's editor core straight from its
// source tree, so the `@` alias points at the desktop `src` directory just as
// it does in `apps/desktop/vite.config.ts`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("../desktop/src", import.meta.url).pathname,
      "@shared": new URL("../desktop/shared", import.meta.url).pathname,
    },
  },
  server: { port: 1430, strictPort: true },
});
