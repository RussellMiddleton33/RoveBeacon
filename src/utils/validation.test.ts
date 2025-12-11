import { describe, it, expect } from 'vitest';
import {
    isValidNumber,
    isValidLatitude,
    isValidLongitude,
    normalizeAngleDegrees
} from './validation';

describe('validation utilities', () => {
    describe('isValidNumber()', () => {
        it('returns true for valid numbers', () => {
            expect(isValidNumber(0)).toBe(true);
            expect(isValidNumber(1)).toBe(true);
            expect(isValidNumber(-1)).toBe(true);
            expect(isValidNumber(3.14159)).toBe(true);
            expect(isValidNumber(-273.15)).toBe(true);
            expect(isValidNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
            expect(isValidNumber(Number.MIN_SAFE_INTEGER)).toBe(true);
        });

        it('returns false for NaN', () => {
            expect(isValidNumber(NaN)).toBe(false);
        });

        it('returns false for Infinity', () => {
            expect(isValidNumber(Infinity)).toBe(false);
            expect(isValidNumber(-Infinity)).toBe(false);
        });

        it('returns false for non-numbers', () => {
            expect(isValidNumber(null)).toBe(false);
            expect(isValidNumber(undefined)).toBe(false);
            expect(isValidNumber('123')).toBe(false);
            expect(isValidNumber('hello')).toBe(false);
            expect(isValidNumber({})).toBe(false);
            expect(isValidNumber([])).toBe(false);
            expect(isValidNumber(true)).toBe(false);
            expect(isValidNumber(false)).toBe(false);
        });
    });

    describe('isValidLatitude()', () => {
        it('returns true for valid latitudes', () => {
            expect(isValidLatitude(0)).toBe(true);
            expect(isValidLatitude(45)).toBe(true);
            expect(isValidLatitude(-45)).toBe(true);
            expect(isValidLatitude(90)).toBe(true);
            expect(isValidLatitude(-90)).toBe(true);
            expect(isValidLatitude(40.7128)).toBe(true);
            expect(isValidLatitude(-33.8688)).toBe(true);
        });

        it('returns false for out-of-range latitudes', () => {
            expect(isValidLatitude(90.1)).toBe(false);
            expect(isValidLatitude(-90.1)).toBe(false);
            expect(isValidLatitude(100)).toBe(false);
            expect(isValidLatitude(-100)).toBe(false);
            expect(isValidLatitude(180)).toBe(false);
        });

        it('returns false for invalid values', () => {
            expect(isValidLatitude(NaN)).toBe(false);
            expect(isValidLatitude(Infinity)).toBe(false);
            expect(isValidLatitude(null)).toBe(false);
            expect(isValidLatitude(undefined)).toBe(false);
            expect(isValidLatitude('45')).toBe(false);
        });
    });

    describe('isValidLongitude()', () => {
        it('returns true for valid longitudes', () => {
            expect(isValidLongitude(0)).toBe(true);
            expect(isValidLongitude(90)).toBe(true);
            expect(isValidLongitude(-90)).toBe(true);
            expect(isValidLongitude(180)).toBe(true);
            expect(isValidLongitude(-180)).toBe(true);
            expect(isValidLongitude(-74.006)).toBe(true);
            expect(isValidLongitude(151.2093)).toBe(true);
        });

        it('returns false for out-of-range longitudes', () => {
            expect(isValidLongitude(180.1)).toBe(false);
            expect(isValidLongitude(-180.1)).toBe(false);
            expect(isValidLongitude(200)).toBe(false);
            expect(isValidLongitude(-200)).toBe(false);
            expect(isValidLongitude(360)).toBe(false);
        });

        it('returns false for invalid values', () => {
            expect(isValidLongitude(NaN)).toBe(false);
            expect(isValidLongitude(Infinity)).toBe(false);
            expect(isValidLongitude(null)).toBe(false);
            expect(isValidLongitude(undefined)).toBe(false);
            expect(isValidLongitude('-74')).toBe(false);
        });
    });

    describe('normalizeAngleDegrees()', () => {
        it('returns angles already in [0, 360) range unchanged', () => {
            expect(normalizeAngleDegrees(0)).toBe(0);
            expect(normalizeAngleDegrees(90)).toBe(90);
            expect(normalizeAngleDegrees(180)).toBe(180);
            expect(normalizeAngleDegrees(270)).toBe(270);
            expect(normalizeAngleDegrees(359.9)).toBeCloseTo(359.9);
        });

        it('normalizes angles >= 360', () => {
            expect(normalizeAngleDegrees(360)).toBe(0);
            expect(normalizeAngleDegrees(361)).toBe(1);
            expect(normalizeAngleDegrees(450)).toBe(90);
            expect(normalizeAngleDegrees(720)).toBe(0);
            expect(normalizeAngleDegrees(810)).toBe(90);
        });

        it('normalizes negative angles', () => {
            expect(normalizeAngleDegrees(-1)).toBe(359);
            expect(normalizeAngleDegrees(-90)).toBe(270);
            expect(normalizeAngleDegrees(-180)).toBe(180);
            expect(normalizeAngleDegrees(-270)).toBe(90);
            // -360 % 360 = -0 in JavaScript, which equals 0 numerically
            expect(normalizeAngleDegrees(-360)).toBeCloseTo(0);
            expect(normalizeAngleDegrees(-450)).toBe(270);
        });

        it('returns 0 for invalid values', () => {
            expect(normalizeAngleDegrees(NaN)).toBe(0);
            expect(normalizeAngleDegrees(Infinity)).toBe(0);
            expect(normalizeAngleDegrees(-Infinity)).toBe(0);
        });

        it('handles edge case at exactly 360', () => {
            expect(normalizeAngleDegrees(360)).toBe(0);
        });

        it('handles very large angles', () => {
            expect(normalizeAngleDegrees(36000)).toBe(0);
            expect(normalizeAngleDegrees(36090)).toBe(90);
        });

        it('handles very negative angles', () => {
            // -36000 % 360 = -0 in JavaScript, which equals 0 numerically
            expect(normalizeAngleDegrees(-36000)).toBeCloseTo(0);
            expect(normalizeAngleDegrees(-36090)).toBe(270);
        });
    });
});
