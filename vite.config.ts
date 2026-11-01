import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
    // The core Three.js vendor chunk is intentionally about 553 kB; model
    // loading/animation helpers are split into their own cacheable chunk.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          'three-models': [
            'three/addons/loaders/GLTFLoader.js',
            'three/addons/utils/SkeletonUtils.js',
            'three/addons/libs/meshopt_decoder.module.js',
          ],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
  },
});
