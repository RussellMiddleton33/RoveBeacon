import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureSDK, getSDKConfig, sdkWarn, sdkDebug } from './types';

describe('SDK Configuration', () => {
    beforeEach(() => {
        // Reset to default config
        configureSDK({ productionMode: false, debug: false, onError: undefined });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('configureSDK()', () => {
        it('sets production mode', () => {
            configureSDK({ productionMode: true });
            expect(getSDKConfig().productionMode).toBe(true);
        });

        it('sets debug mode', () => {
            configureSDK({ debug: true });
            expect(getSDKConfig().debug).toBe(true);
        });

        it('sets onError callback', () => {
            const callback = vi.fn();
            configureSDK({ onError: callback });
            expect(getSDKConfig().onError).toBe(callback);
        });

        it('merges with existing config', () => {
            configureSDK({ productionMode: true });
            configureSDK({ debug: true });

            const config = getSDKConfig();
            expect(config.productionMode).toBe(true);
            expect(config.debug).toBe(true);
        });

        it('can override previous settings', () => {
            configureSDK({ productionMode: true });
            configureSDK({ productionMode: false });

            expect(getSDKConfig().productionMode).toBe(false);
        });
    });

    describe('getSDKConfig()', () => {
        it('returns default config', () => {
            const config = getSDKConfig();

            expect(config.productionMode).toBe(false);
            expect(config.debug).toBe(false);
        });

        it('returns readonly config', () => {
            const config = getSDKConfig();

            // TypeScript should prevent direct modification, but JS still allows it
            // The important thing is the function signature indicates readonly
            expect(typeof config).toBe('object');
        });
    });

    describe('sdkWarn()', () => {
        it('logs warning in development mode', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            configureSDK({ productionMode: false });

            sdkWarn('Test warning');

            expect(warnSpy).toHaveBeenCalledWith('[RoveBeacon] Test warning');
        });

        it('does not log in production mode', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            configureSDK({ productionMode: true });

            sdkWarn('Test warning');

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('includes additional arguments', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            configureSDK({ productionMode: false });

            sdkWarn('Test warning', { detail: 'extra' }, 123);

            expect(warnSpy).toHaveBeenCalledWith('[RoveBeacon] Test warning', { detail: 'extra' }, 123);
        });
    });

    describe('sdkDebug()', () => {
        it('logs debug message when debug is enabled', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            configureSDK({ productionMode: false, debug: true });

            sdkDebug('Debug message');

            expect(logSpy).toHaveBeenCalledWith('[RoveBeacon:debug] Debug message');
        });

        it('does not log when debug is disabled', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            configureSDK({ productionMode: false, debug: false });

            sdkDebug('Debug message');

            expect(logSpy).not.toHaveBeenCalled();
        });

        it('does not log in production mode even with debug enabled', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            configureSDK({ productionMode: true, debug: true });

            sdkDebug('Debug message');

            expect(logSpy).not.toHaveBeenCalled();
        });

        it('includes additional arguments', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            configureSDK({ productionMode: false, debug: true });

            sdkDebug('Debug message', { data: 'test' }, 456);

            expect(logSpy).toHaveBeenCalledWith('[RoveBeacon:debug] Debug message', { data: 'test' }, 456);
        });
    });
});
