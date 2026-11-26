import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx tests/e2e/fake-ollama.ts', url: 'http://127.0.0.1:11535/api/tags', reuseExistingServer: false },
    { command: 'tsx server/index.ts', url: 'http://127.0.0.1:8797/api/health', reuseExistingServer: false,
      env: { PORT: '8797', OLLAMA_URL: 'http://127.0.0.1:11535', OLLAMA_MODEL: 'fake', NODE_ENV: 'test' } },
    { command: 'npm run build && npm run preview -- --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 120_000,
      env: { API_TARGET: 'http://127.0.0.1:8797' } },
  ],
});
