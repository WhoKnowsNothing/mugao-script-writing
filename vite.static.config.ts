import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./static', import.meta.url)),
  base: '/mugao/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: fileURLToPath(new URL('./out/mugao', import.meta.url)),
    emptyOutDir: true,
  },
});
