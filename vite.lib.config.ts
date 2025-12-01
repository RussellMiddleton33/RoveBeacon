import { defineConfig } from 'vite';
import { resolve } from 'path';

// Library build configuration - builds only the SDK
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/index.ts'),
      name: 'ThreeJSUserLocation',
      fileName: 'threejs-user-location',
    },
    rollupOptions: {
      // Externalize three.js - users must provide it
      external: ['three'],
      output: {
        globals: {
          three: 'THREE',
        },
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
});
