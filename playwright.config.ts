import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  webServer: {
    command: 'pnpm --filter @zilventor/app dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120_000
  },
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'perf',
      testDir: './tests/perf',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
