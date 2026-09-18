import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(process.env.PORT || env.PORT || 5173);
  const backendUrl = process.env.BACKEND_URL || env.BACKEND_URL || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true
        }
      }
    }
  };
});
