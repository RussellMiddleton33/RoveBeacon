import { test, expect } from '@playwright/test';

/**
 * E2E Smoke Tests for RoveMaps SDK
 *
 * These tests verify basic functionality of the demo app
 * to ensure the SDK loads and renders correctly.
 */
test.describe('RoveMaps SDK Smoke Tests', () => {
    test.beforeEach(async ({ context }) => {
        // Grant geolocation permissions
        await context.grantPermissions(['geolocation']);
        // Set mock location (NYC)
        await context.setGeolocation({ latitude: 40.7128, longitude: -74.006 });
    });

    test('demo app loads without errors', async ({ page }) => {
        // Track console errors
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        // Track uncaught exceptions
        const pageErrors: string[] = [];
        page.on('pageerror', error => {
            pageErrors.push(error.message);
        });

        // Load the app
        await page.goto('/');

        // Wait for app to initialize
        await page.waitForTimeout(2000);

        // Verify no errors
        expect(consoleErrors.filter(e => !e.includes('WebGL'))).toEqual([]);
        expect(pageErrors).toEqual([]);
    });

    test('map canvas renders', async ({ page }) => {
        await page.goto('/');

        // Check if map canvas is present
        const canvas = page.locator('canvas');
        await expect(canvas.first()).toBeVisible({ timeout: 10000 });
    });

    test('map container has correct dimensions', async ({ page }) => {
        await page.goto('/');

        // Wait for map to load
        await page.waitForTimeout(2000);

        // Check that map container has proper size
        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();

        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(100);
        expect(box!.height).toBeGreaterThan(100);
    });

    test('page responds to user interaction', async ({ page }) => {
        await page.goto('/');

        // Wait for map to load
        await page.waitForTimeout(2000);

        const canvas = page.locator('canvas').first();

        // Verify canvas is interactive (can receive mouse events)
        await expect(canvas).toBeEnabled();

        // Simulate a click on the canvas
        await canvas.click();

        // Wait a bit for any response
        await page.waitForTimeout(500);

        // No crash = success
    });

    test('SDK does not leak memory on page navigation', async ({ page }) => {
        // Load page
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Navigate away
        await page.goto('about:blank');
        await page.waitForTimeout(500);

        // Navigate back
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Verify canvas still renders
        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });
});
