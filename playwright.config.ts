import { defineConfig, devices } from '@playwright/test';

// Optional override for a pre-installed Chromium (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium).
// In CI the browser comes from `npx playwright install chromium`.
// Needs all three builds first: npm run build && npm run build:crazygames && npm run build:gd
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: executablePath ? { executablePath } : {},
  },
  // one preview server per build: web (dist/, smoke test), crazygames and gd (see vite.config.ts)
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'npx vite preview --mode crazygames --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'npx vite preview --mode gd --port 4175 --strictPort', url: 'http://localhost:4175', reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone-portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
