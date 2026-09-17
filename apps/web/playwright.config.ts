import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
    channel: "chrome", // 用本机已装 Chrome，免下载 chromium
  },
});
