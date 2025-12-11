/**
 * Performance module exports
 *
 * Provides quality management, frame monitoring, animation batching,
 * and battery-aware power management for optimal mobile performance.
 */

// Quality presets and settings
export {
  type QualityPreset,
  type QualitySettings,
  QUALITY_PRESETS,
  getDefaultQualitySettings,
} from './QualityPresets';

// Quality manager
export {
  QualityManager,
  type QualityManagerOptions,
  getGlobalQualityManager,
  setGlobalQualityManager,
} from './QualityManager';

// Frame monitoring
export {
  FrameMonitor,
  type FrameMonitorOptions,
  type FrameStats,
} from './FrameMonitor';

// Shared animation loop
export {
  AnimationManager,
  AnimationManagerSingleton,
  type AnimationCallback,
  type AnimationManagerOptions,
} from './AnimationManager';

// Battery monitoring
export {
  BatteryManager,
  type BatteryManagerOptions,
  type BatteryState,
  getGlobalBatteryManager,
  setGlobalBatteryManager,
} from './BatteryManager';
