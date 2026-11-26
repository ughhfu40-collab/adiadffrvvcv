import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/api': apiTarget } },
  preview: { proxy: { '/api': apiTarget } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Oqy — читать и понимать', short_name: 'Oqy', lang: 'ru', display: 'standalone',
        theme_color: '#4f46e5', background_color: '#ffffff', start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,json}'], navigateFallback: 'index.html', navigateFallbackDenylist: [/^\/api\//], cleanupOutdatedCaches: true },
    }),
  ],
});
