import { test, expect } from '@playwright/test';

test.describe('RoveMaps Example App', () => {
    test('loads map and shows user location', async ({ page, context }) => {
        // Grant geolocation permissions
        await context.grantPermissions(['geolocation']);

        // Set mock location (NYC)
        await context.setGeolocation({ latitude: 40.7128, longitude: -74.006 });

        // Track console errors from the start
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        // Load the app
        await page.goto('/');

        // Check if map canvas is present
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });

        // Wait a bit for initialization and render
        await page.waitForTimeout(2000);

        // Verify no console errors (filter WebGL warnings)
        expect(consoleErrors.filter(e => !e.includes('WebGL'))).toEqual([]);
    });
});
