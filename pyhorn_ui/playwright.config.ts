import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright test configuration for pyhorn_ui
 *
 * Two test suites:
 *
 * 1. Frontend smoke tests (chromium project)
 *    - Tests the React UI via the Vite dev server (localhost:1420)
 *    - Fast, reliable, catches most regressions
 *    - Run: npx playwright test
 *
 * 2. Tauri E2E tests (tauri-e2e project)
 *    - Launches the compiled macOS .app bundle
 *    - Prerequisites:
 *        - API server running on port 8765
 *        - Built .app bundle at src-tauri/target/release/bundle/macos/pyhorn.app
 *        - Electron installed (npm install -D electron)
 *    - Run explicitly: npx playwright test --project=tauri-e2e
 *
 * Full suite (CI): npx playwright test
 */

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    // Frontend smoke tests — fast React UI tests via Vite dev server
    // The Tauri app renders the same React frontend, so these cover the UI adequately.
    {
      name: "chromium",
      testMatch: "smoke.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    // Tauri E2E tests — launch the compiled macOS .app bundle
    // Requires: API on :8765 + .app bundle + `npm install -D electron`
    // Explicit: npx playwright test --project=tauri-e2e
    {
      name: "tauri-e2e",
      testMatch: "tauri-e2e.spec.ts",
      timeout: 120_000,
    },
  ],
  // Start Vite dev server for the chromium project
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
