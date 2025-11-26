import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  clearScreen: false,
  plugins: [
    react(),
    {
      name: "server-hmr",
      handleHotUpdate({ file, server }) {
        if (file.includes("src/party/")) {
          server.ws.send({
            type: "full-reload",
            path: "*",
          })
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/app"),
    },
  },
  server: {
    headers: {
      // Required for OPFS + synchronous access in workers.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
  optimizeDeps: {
    exclude: ["wa-sqlite"],
  },
})
