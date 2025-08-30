import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
      output: {
        manualChunks: () => null,
        entryFileNames: (chunkInfo) => {
          // Keep background/content at root for manifest references
          if (chunkInfo.name === 'background' || chunkInfo.name === 'content') {
            return `${chunkInfo.name}/index.js`;
          }
          return 'assets/[name].js';
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'assets/[name][extname]';
          return 'assets/[name][extname]';
        },
      },
    },
    emptyOutDir: true,
  },
});
