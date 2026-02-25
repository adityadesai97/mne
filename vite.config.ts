import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'mne',
        short_name: 'mne',
        description: 'Personal finance tracker',
        theme_color: '#0D0D0D',
        background_color: '#0D0D0D',
        display: 'standalone',
        icons: [
          { src: '/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
  },
})
