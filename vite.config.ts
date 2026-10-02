import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ inspectorPort: false })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /** Framework code changes rarely; keeping it in its own chunk lets browsers cache it across deploys. */
        manualChunks(id) {
          if (
            /node_modules\/(react|react-dom|scheduler|radix-ui|@radix-ui|@floating-ui|sonner|lucide-react)\//.test(
              id,
            )
          )
            return "vendor";
          return undefined;
        },
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
