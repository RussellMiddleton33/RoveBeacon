/**
 * Quality preset system for adaptive performance
 *
 * Presets control geometry complexity, animation smoothing, and visual effects
 * to balance quality vs performance on different devices.
 */

/**
 * Available quality presets
 * - 'auto': Automatically detect based on device capabilities
 * - 'low': Minimal visual effects, best for low-end devices
 * - 'medium': Balanced quality and performance
 * - 'high': Full visual quality for powerful devices
 */
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';

/**
 * Resolved quality settings for rendering
 */
export interface QualitySettings {
  /** Number of segments for ring geometry (16, 32, or 64) */
  ringSegments: number;

  /** Number of layers for direction cone (3, 5, or 8) */
  coneLayers: number;

  /** Number of segments for dot/border circles */
  circleSegments: number;

  /** Enable smooth position interpolation */
  smoothPosition: boolean;

  /** Enable smooth heading interpolation */
  smoothHeading: boolean;

  /** Enable pulse animation */
  pulseEnabled: boolean;

  /** Pulse animation speed (cycles per second) */
  pulseSpeed: number;

  /** Position smoothing factor (higher = faster interpolation) */
  positionSmoothingFactor: number;

  /** Heading smoothing factor (higher = faster interpolation) */
  headingSmoothingFactor: number;
}

/**
 * Preset configurations for each quality level
 */
export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'auto'>, QualitySettings> = {
  low: {
    ringSegments: 16,
    coneLayers: 3,
    circleSegments: 16,
    smoothPosition: false,
    smoothHeading: false,
    pulseEnabled: true,
    pulseSpeed: 0.15,
    positionSmoothingFactor: 0.1,
    headingSmoothingFactor: 0.2,
  },
  medium: {
    ringSegments: 32,
    coneLayers: 5,
    circleSegments: 24,
    smoothPosition: true,
    smoothHeading: true,
    pulseEnabled: true,
    pulseSpeed: 0.2,
    positionSmoothingFactor: 0.03,
    headingSmoothingFactor: 0.15,
  },
  high: {
    ringSegments: 64,
    coneLayers: 8,
    circleSegments: 32,
    smoothPosition: true,
    smoothHeading: true,
    pulseEnabled: true,
    pulseSpeed: 0.3,
    positionSmoothingFactor: 0.03,
    headingSmoothingFactor: 0.15,
  },
};

/**
 * Get the default quality settings (high preset)
 */
export function getDefaultQualitySettings(): QualitySettings {
  return { ...QUALITY_PRESETS.high };
}
