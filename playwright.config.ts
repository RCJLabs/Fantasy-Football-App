import { defineConfig, devices } from '@playwright/test';

// End-to-end smoke test of the built app with Sleeper and the data files mocked (see e2e/).
const PORT = 4173;
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/Fantasy-Football-App/`,
    serviceWorkers: 'block', // the SW would bypass request mocking
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    env: { BASE_PATH: '/Fantasy-Football-App/' },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
