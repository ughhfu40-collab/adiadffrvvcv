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
        theme_color: '#245740', background_color: '#F8F5ED', start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      // Шрифты: в precache только кириллица и латиница (в т.ч. казахские буквы в cyrillic-ext); прочие подмножества грузятся лишь при необходимости.
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,json}', '**/*-{latin,latin-ext,cyrillic,cyrillic-ext}-wght-normal-*.woff2'],
        globIgnores: ['version.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//, /\/version\.json(?:\?|$)/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
