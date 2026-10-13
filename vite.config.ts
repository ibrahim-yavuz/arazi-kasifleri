import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    // The room server (npm run dev:server) runs on 8787; the page talks to /ws on its own host.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  preview: {
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    // Rapier's compat package inlines its WebAssembly (~4 MB as base64) in one module.
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks: {
          rapier: ['@dimforge/rapier3d-compat'],
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
