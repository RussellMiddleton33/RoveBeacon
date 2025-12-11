/**
 * Shared validation utilities for the SDK
 */

/**
 * Validates that a value is a finite number
 * @param value The value to check
 * @returns true if value is a finite number, false otherwise
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates that a latitude value is valid (-90 to 90)
 * @param lat The latitude to validate
 * @returns true if valid latitude, false otherwise
 */
export function isValidLatitude(lat: unknown): lat is number {
  return isValidNumber(lat) && lat >= -90 && lat <= 90;
}

/**
 * Validates that a longitude value is valid (-180 to 180)
 * @param lng The longitude to validate
 * @returns true if valid longitude, false otherwise
 */
export function isValidLongitude(lng: unknown): lng is number {
  return isValidNumber(lng) && lng >= -180 && lng <= 180;
}

/**
 * Normalizes an angle in degrees to [0, 360) range
 * @param degrees Angle in degrees (can be any value)
 * @returns Normalized angle in [0, 360) range
 */
export function normalizeAngleDegrees(degrees: number): number {
  if (!isValidNumber(degrees)) return 0;
  let normalized = degrees % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}
