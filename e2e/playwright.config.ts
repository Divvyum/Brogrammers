import { defineConfig } from "@playwright/test";

// Browser tests for the admin portal against the running dev stack:
//   pnpm dev            (terminal 1)
//   pnpm seed --pipeline && pnpm simulate enroll --count 3
//   pnpm test:e2e
export default defineConfig({
  testDir: ".",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1360, height: 900 },
    screenshot: "only-on-failure",
  },
  outputDir: "../node_modules/.e2e-results",
});
