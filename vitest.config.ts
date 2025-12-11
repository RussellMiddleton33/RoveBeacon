import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            // Coverage thresholds - fail if below these values
            thresholds: {
                statements: 75,
                branches: 65,
                functions: 80,
                lines: 75,
            },
            // Include library source files
            include: ['src/lib/**/*.ts', 'src/utils/**/*.ts'],
            // Exclude test files and types
            exclude: [
                'src/**/*.test.ts',
                'src/**/*.spec.ts',
                'src/lib/index.ts',
                'src/lib/react/index.ts',
                'src/lib/mapbox/index.ts',
                'src/lib/maplibre/index.ts',
                'src/lib/three/index.ts',
            ],
        },
        include: ['src/**/*.{test,spec}.{js,ts}'],
    },
});
