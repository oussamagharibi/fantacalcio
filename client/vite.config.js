import { defineConfig } from 'vite';

export default defineConfig({
  // niente @vitejs/plugin-react: esbuild trasforma i .jsx da solo.
  esbuild: { jsx: 'automatic' },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
});
