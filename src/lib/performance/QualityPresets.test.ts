import { describe, it, expect } from 'vitest';
import { QUALITY_PRESETS, getDefaultQualitySettings } from './QualityPresets';
import type { QualitySettings } from './QualityPresets';

describe('QualityPresets', () => {
    describe('QUALITY_PRESETS', () => {
        it('has low, medium, and high presets', () => {
            expect(QUALITY_PRESETS.low).toBeDefined();
            expect(QUALITY_PRESETS.medium).toBeDefined();
            expect(QUALITY_PRESETS.high).toBeDefined();
        });

        describe('low preset', () => {
            it('has minimal geometry segments', () => {
                expect(QUALITY_PRESETS.low.ringSegments).toBe(16);
                expect(QUALITY_PRESETS.low.coneLayers).toBe(3);
                expect(QUALITY_PRESETS.low.circleSegments).toBe(16);
            });

            it('has smoothing disabled', () => {
                expect(QUALITY_PRESETS.low.smoothPosition).toBe(false);
                expect(QUALITY_PRESETS.low.smoothHeading).toBe(false);
            });

            it('has pulse enabled with slow speed', () => {
                expect(QUALITY_PRESETS.low.pulseEnabled).toBe(true);
                expect(QUALITY_PRESETS.low.pulseSpeed).toBe(0.15);
            });

            it('has high smoothing factors (for faster response when enabled)', () => {
                expect(QUALITY_PRESETS.low.positionSmoothingFactor).toBe(0.1);
                expect(QUALITY_PRESETS.low.headingSmoothingFactor).toBe(0.2);
            });
        });

        describe('medium preset', () => {
            it('has moderate geometry segments', () => {
                expect(QUALITY_PRESETS.medium.ringSegments).toBe(32);
                expect(QUALITY_PRESETS.medium.coneLayers).toBe(5);
                expect(QUALITY_PRESETS.medium.circleSegments).toBe(24);
            });

            it('has smoothing enabled', () => {
                expect(QUALITY_PRESETS.medium.smoothPosition).toBe(true);
                expect(QUALITY_PRESETS.medium.smoothHeading).toBe(true);
            });

            it('has pulse enabled with moderate speed', () => {
                expect(QUALITY_PRESETS.medium.pulseEnabled).toBe(true);
                expect(QUALITY_PRESETS.medium.pulseSpeed).toBe(0.2);
            });

            it('has balanced smoothing factors', () => {
                expect(QUALITY_PRESETS.medium.positionSmoothingFactor).toBe(0.03);
                expect(QUALITY_PRESETS.medium.headingSmoothingFactor).toBe(0.15);
            });
        });

        describe('high preset', () => {
            it('has high geometry segments', () => {
                expect(QUALITY_PRESETS.high.ringSegments).toBe(64);
                expect(QUALITY_PRESETS.high.coneLayers).toBe(8);
                expect(QUALITY_PRESETS.high.circleSegments).toBe(32);
            });

            it('has smoothing enabled', () => {
                expect(QUALITY_PRESETS.high.smoothPosition).toBe(true);
                expect(QUALITY_PRESETS.high.smoothHeading).toBe(true);
            });

            it('has pulse enabled with faster speed', () => {
                expect(QUALITY_PRESETS.high.pulseEnabled).toBe(true);
                expect(QUALITY_PRESETS.high.pulseSpeed).toBe(0.3);
            });

            it('has smooth interpolation factors', () => {
                expect(QUALITY_PRESETS.high.positionSmoothingFactor).toBe(0.03);
                expect(QUALITY_PRESETS.high.headingSmoothingFactor).toBe(0.15);
            });
        });

        it('presets have progressively higher quality', () => {
            expect(QUALITY_PRESETS.low.ringSegments).toBeLessThan(QUALITY_PRESETS.medium.ringSegments);
            expect(QUALITY_PRESETS.medium.ringSegments).toBeLessThan(QUALITY_PRESETS.high.ringSegments);

            expect(QUALITY_PRESETS.low.coneLayers).toBeLessThan(QUALITY_PRESETS.medium.coneLayers);
            expect(QUALITY_PRESETS.medium.coneLayers).toBeLessThan(QUALITY_PRESETS.high.coneLayers);
        });

        it('all presets have required properties', () => {
            const requiredProperties: (keyof QualitySettings)[] = [
                'ringSegments',
                'coneLayers',
                'circleSegments',
                'smoothPosition',
                'smoothHeading',
                'pulseEnabled',
                'pulseSpeed',
                'positionSmoothingFactor',
                'headingSmoothingFactor'
            ];

            for (const preset of ['low', 'medium', 'high'] as const) {
                for (const prop of requiredProperties) {
                    expect(QUALITY_PRESETS[preset][prop]).toBeDefined();
                }
            }
        });
    });

    describe('getDefaultQualitySettings()', () => {
        it('returns a copy of high preset', () => {
            const defaults = getDefaultQualitySettings();

            expect(defaults).toEqual(QUALITY_PRESETS.high);
        });

        it('returns a new object each time (not a reference)', () => {
            const defaults1 = getDefaultQualitySettings();
            const defaults2 = getDefaultQualitySettings();

            expect(defaults1).not.toBe(defaults2);
            expect(defaults1).toEqual(defaults2);
        });

        it('modifications do not affect original preset', () => {
            const defaults = getDefaultQualitySettings();
            defaults.ringSegments = 999;

            expect(QUALITY_PRESETS.high.ringSegments).toBe(64);
        });
    });
});
