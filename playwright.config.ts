import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4273', serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx tests/e2e/fake-ollama.ts', url: 'http://127.0.0.1:11535/api/tags', reuseExistingServer: false },
    { command: 'tsx server/index.ts', url: 'http://127.0.0.1:8797/api/health', reuseExistingServer: false,
      env: { PORT: '8797', OLLAMA_URL: 'http://127.0.0.1:11535', OLLAMA_MODEL: 'fake', NODE_ENV: 'test', OLLAMA_TIMEOUT_MS: '5000' } },
    // Отдельный порт и --strictPort: e2e никогда не подхватит ручной preview на 4173, проксирующий к настоящей модели.
    { command: 'npm run build && npx vite preview --port 4273 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4273', reuseExistingServer: false, timeout: 120_000,
      env: { API_TARGET: 'http://127.0.0.1:8797' } },
  ],
});
