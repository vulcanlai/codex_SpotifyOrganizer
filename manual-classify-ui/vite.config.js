import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  root: __dirname,
  base: '/',
  resolve: {
    alias: {
      '@manual_classify_lib': path.join(__dirname, '..', 'lib', 'classification', 'manual_classify'),
    },
  },
  build: {
    outDir: path.join(__dirname, '..', 'public', 'manual-classify-ui'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8892',
        changeOrigin: true,
      },
    },
  },
});
