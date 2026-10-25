import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Historical QA pages stay available on demand, outside the app's initial scan.
  optimizeDeps: { entries: ["index.html"] },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
