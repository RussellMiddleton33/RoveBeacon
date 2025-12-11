import { defineConfig } from 'vite';
import { resolve } from 'path';

// Library build configuration - builds only the SDK
export default defineConfig({
  define: {
    // Replace process.env.NODE_ENV for browser compatibility
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/lib/index.ts'),
      name: 'RoveMapsYouAreHere',
      fileName: 'rovemaps-you-are-here',
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
