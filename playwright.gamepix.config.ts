import { defineConfig, devices } from '@playwright/test';

// GamePix build e2e (tests/e2e-gamepix/, mock SDK): kept apart from playwright.config.ts so the
// web / CrazyGames / GameDistribution runs are unchanged. Needs: npm run build:gamepix
// Optional override for a pre-installed Chromium: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e-gamepix',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-gamepix' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4196',
    trace: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    { command: 'npx vite preview --mode gamepix --port 4196 --strictPort', url: 'http://localhost:4196', reuseExistingServer: false, timeout: 60_000 },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone-portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
