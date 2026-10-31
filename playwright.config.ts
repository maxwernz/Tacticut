import { defineConfig } from "@playwright/test";
// Launched apps inherit this, so test runs never pop up a window or steal focus.
// Run with TACTICUT_SHOW=1 to watch the app while debugging a test.
if (!process.env.TACTICUT_SHOW) process.env.TACTICUT_HIDDEN = "1";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  workers: 1,
  reporter: "list",
});
