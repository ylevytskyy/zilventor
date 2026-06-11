/**
 * Playwright config for this worktree's e2e run.
 * Uses the dev server already running on port 5182 (started manually from the worktree).
 * The main playwright.config.ts uses port 5173 which may be occupied by another checkout.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  webServer: {
    command: 'cd packages/app && npx vite --port 5182',
    port: 5182,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://localhost:5182',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'perf',
      testDir: './tests/perf',
      use: { ...devices['Desktop Chrome'] },
      retries: 1,
    },
  ],
});
