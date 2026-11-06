import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const codespaceHost =
  process.env.CODESPACE_NAME &&
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : "";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: codespaceHost ? [codespaceHost] : [],
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", timeout: 0, proxyTimeout: 0 },
    },
  },
});
