import { defineConfig } from "@playwright/test";

const visibleOnly = process.env.LAB_VISIBLE === "1";

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  projects: [
    {
      name: "chrome",
      use: {
        channel: "chrome",
        headless: visibleOnly ? false : true,
      },
    },
  ],
  reporter: "list",
  testDir: "./tests",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5185",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev:fixtures",
    reuseExistingServer: true,
    url: "http://127.0.0.1:5185",
  },
});
