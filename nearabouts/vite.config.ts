import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: r('./src/web'),
  publicDir: r('./public'),
  plugins: [react()],
  build: { outDir: r('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/socket.io': { target: 'http://localhost:8787', ws: true } },
  },
});
