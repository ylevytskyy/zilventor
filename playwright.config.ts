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
      // Exclude the built-artifact spec — it targets port 5193 (vite preview)
      // and must not run against the dev server.
      testIgnore: /kernel-built-artifact\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      // Firefox smoke: a small subset of core specs (OPFS + kernel + basic
      // modeling). Kept narrow to avoid blowing CI time on the full 158-test
      // suite in a second browser.
      name: 'firefox',
      testDir: './tests/e2e',
      testMatch: [
        'workflow-2-create-box.spec.ts',
        'workflow-3-edit-undo.spec.ts',
        'file-open-overlay-cancel.spec.ts',
      ],
      use: { ...devices['Desktop Firefox'] }
    },
    {
      // Built-artifact: verifies the production Vite build (dist/) boots and
      // the kernel worker runs OCCT correctly. Relies on an externally-started
      // `vite preview --port 5193` (CI starts it before this project runs).
      // No webServer here — we don't want every `playwright test` invocation
      // to trigger a full build.
      name: 'built-artifact',
      testMatch: /kernel-built-artifact\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5193'
      }
    },
    {
      name: 'perf',
      testDir: './tests/perf',
      use: { ...devices['Desktop Chrome'] },
      retries: 1
    }
  ]
});
