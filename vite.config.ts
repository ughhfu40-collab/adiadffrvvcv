import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

const buildSha = process.env.VITE_BUILD_SHA ?? process.env.GITHUB_SHA ?? (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'dev'; } })();
process.env.VITE_BUILD_SHA = buildSha;

const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8787';
// Vite меняет Host для строковой настройки прокси. API сверяет Origin с исходным Host.
const apiProxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  plugins: [
    react(),
    {
      // version.json — проверка, что хостинг отдаёт именно эту сборку (не кешируется service worker).
      name: 'build-stamp',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ sha: buildSha, builtAt: new Date().toISOString(), studentOnly: process.env.VITE_STUDENT_ONLY === 'true' }) });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Oqy — читать и понимать', short_name: 'Oqy', lang: 'ru', display: 'standalone',
        theme_color: '#2547A0', background_color: '#F7F5EF', start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      // Шрифты: в сборку попадают только подмножества latin, cyrillic и cyrillic-ext (казахские буквы) — все они в precache.
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,json,woff2}'],
        globIgnores: ['version.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//, /\/version\.json(?:\?|$)/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
