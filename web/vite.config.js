import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 浏览器始终请求同源的 /api/*：
// - 本地 dev / preview / Playwright 联调时由 Vite 代理到本机 uvicorn；
// - Docker 内由 nginx 代理到 api 服务。
const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8123",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
