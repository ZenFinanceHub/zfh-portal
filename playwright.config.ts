import { defineConfig, devices } from "@playwright/test";

// Runs against the LOCAL Supabase (see .env.local) with the dev server on :3000,
// which is the site URL local Supabase allows magic-link redirects to.
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", ...devices["Pixel 7"] },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/auth/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
