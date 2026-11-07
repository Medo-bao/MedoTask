import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import pkg from './package.json' with { type: 'json' }

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: 'medotask-build-info',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify({ version: pkg.version, edition: mode === 'clean' ? 'clean' : 'full' }),
        })
      },
    },
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __HAS_ASSISTANT__: mode !== 'clean',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: mode === 'clean' ? 'dist-clean' : 'dist',
    target: 'es2022',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5174,
    strictPort: false,
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
}))
