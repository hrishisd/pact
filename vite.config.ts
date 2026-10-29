import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { AUTH_ERROR_PATH, INVITE_REQUIRED_PATH } from "./src/shared/api.ts";

// The client lives in src/client and builds to dist/client, which the server serves.
// In development the browser talks to Vite (5173), which forwards everything
// server-side to the API server (3000), so cookies and OAuth redirects stay on one origin.
const server = "http://localhost:3000";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Lets an iPhone on the same Wi-Fi open the dev server.
    host: true,
    proxy: {
      // Trailing slash so the client module /api.ts isn't proxied too. xfwd
      // passes on the browser's host and address, which the dev sign-in checks.
      "/api/": { target: server, changeOrigin: true, xfwd: true },
      "/health": server,
      [AUTH_ERROR_PATH]: server,
      [INVITE_REQUIRED_PATH]: server,
    },
  },
});
