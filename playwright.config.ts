import { defineConfig, devices } from '@playwright/test';

// Порты можно переопределить (E2E_WEB_PORT, E2E_API_PORT, E2E_FAKE_PORT), чтобы параллельные прогоны на одной машине не мешали друг другу.
// Значения по умолчанию — прежние: CI не меняется.
const WEB = process.env.E2E_WEB_PORT ?? '4273';
const API = process.env.E2E_API_PORT ?? '8797';
const FAKE = process.env.E2E_FAKE_PORT ?? '11535';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${WEB}`, serviceWorkers: 'allow', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx tests/e2e/fake-ollama.ts', url: `http://127.0.0.1:${FAKE}/api/tags`, reuseExistingServer: false,
      env: { FAKE_OLLAMA_PORT: FAKE } },
    { command: 'tsx server/index.ts', url: `http://127.0.0.1:${API}/api/health`, reuseExistingServer: false,
      env: { PORT: API, OLLAMA_URL: `http://127.0.0.1:${FAKE}`, OLLAMA_MODEL: 'fake', NODE_ENV: 'test', OLLAMA_TIMEOUT_MS: '5000' } },
    // Отдельный порт и --strictPort: e2e никогда не подхватит ручной preview на 4173, проксирующий к настоящей модели.
    { command: `npm run build && npx vite preview --port ${WEB} --strictPort --host 127.0.0.1`, url: `http://127.0.0.1:${WEB}`, reuseExistingServer: false, timeout: 120_000,
      env: { API_TARGET: `http://127.0.0.1:${API}` } },
  ],
});
