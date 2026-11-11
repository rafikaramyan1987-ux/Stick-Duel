import { defineConfig, devices } from '@playwright/test';

// Y8 build e2e (tests/e2e-y8/, stubbed SDK): kept apart from playwright.config.ts so the other builds' runs are
// unchanged. Needs: npm run build:y8
// Optional override for a pre-installed Chromium: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e-y8',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-y8' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4198',
    trace: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    { command: 'npx vite preview --mode y8 --port 4198 --strictPort', url: 'http://localhost:4198', reuseExistingServer: false, timeout: 60_000 },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone-portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
