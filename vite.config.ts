import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { geminiProxyMiddleware } from './gemini-proxy-middleware';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const geminiMw = geminiProxyMiddleware(env);

  return {
    plugins: [
      react(),
      {
        name: 'gemini-api-proxy',
        configureServer(server) {
          server.middlewares.use(geminiMw);
        },
        configurePreviewServer(server) {
          server.middlewares.use(geminiMw);
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
