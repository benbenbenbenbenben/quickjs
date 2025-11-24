import { defineConfig, devices } from '@playwright/test';

const useExternalBaseURL = !!process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
  },
  // When no PLAYWRIGHT_BASE_URL is provided, start the Vite dev
  // server for tests. In containerized runs, we instead point at
  // the pre-built nginx server via PLAYWRIGHT_BASE_URL.
  webServer: useExternalBaseURL
    ? undefined
    : {
        command: 'npm run start -- --host 0.0.0.0 --port 8080',
        port: 8080,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
