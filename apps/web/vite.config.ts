import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 9731,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:9730',
      '/audio': 'http://localhost:9730',
      '/ws': { target: 'ws://localhost:9730', ws: true },
    },
  },
});
