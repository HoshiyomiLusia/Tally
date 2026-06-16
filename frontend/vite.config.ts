import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // 子路径部署: 构建时由 VITE_BASE 注入 (如 "/tally/"); 默认 "/" 保持根部署不变
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8002",
    },
  },
  build: {
    outDir: "dist",
  },
});
