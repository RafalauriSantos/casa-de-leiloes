import { defineConfig, devices } from "@playwright/test";

// `make e2e-browser`: the real site and the real API, in a browser, against the local database.
// The API and the site start here; the seed runs once before the tests (global-setup).
const WEB = "http://localhost:5173";
const API = "http://localhost:8787";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { baseURL: WEB, ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "npm run dev -w @casa/backend",
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev -w @casa/frontend",
      url: WEB,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
