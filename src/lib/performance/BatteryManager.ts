/**
 * BatteryManager - Power-aware quality adjustment
 *
 * Monitors device battery level and triggers callbacks when power state changes.
 * Enables automatic quality reduction on low battery to extend device life.
 *
 * Note: Battery Status API is not available on all browsers (notably iOS Safari).
 * The manager gracefully degrades to 'unavailable' state when not supported.
 */

export type BatteryState = 'normal' | 'low' | 'critical' | 'charging' | 'unavailable';

export interface BatteryManagerOptions {
  /**
   * Battery level (0-1) to trigger low-power mode
   * @default 0.2 (20%)
   */
  lowPowerThreshold?: number;

  /**
   * Battery level (0-1) to trigger critical mode
   * @default 0.1 (10%)
   */
  criticalThreshold?: number;

  /**
   * Callback when battery state changes
   */
  onBatteryStateChange?: (state: BatteryState) => void;
}

/**
 * Battery status interface (Navigator.getBattery() result)
 */
interface BatteryStatus {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Monitors battery status and fires callbacks on state changes
 *
 * @example
 * ```typescript
 * const battery = new BatteryManager({
 *   onBatteryStateChange: (state) => {
 *     if (state === 'low' || state === 'critical') {
 *       qualityManager.setPreset('low');
 *     }
 *   },
 * });
 *
 * // Or use the global instance
 * import { getGlobalBatteryManager } from 'rovemaps-you-are-here';
 *
 * getGlobalBatteryManager().onStateChange((state) => {
 *   console.log('Battery state:', state);
 * });
 * ```
 */
export class BatteryManager {
  private battery: BatteryStatus | null = null;
  private state: BatteryState = 'unavailable';
  private options: Required<BatteryManagerOptions>;
  private listeners: Set<(state: BatteryState) => void> = new Set();
  private boundUpdateState: () => void;
  private isDisposed = false;

  constructor(options: BatteryManagerOptions = {}) {
    this.options = {
      lowPowerThreshold: 0.2,
      criticalThreshold: 0.1,
      onBatteryStateChange: () => {},
      ...options,
    };

    // Bind the update function once for proper cleanup
    this.boundUpdateState = () => this.updateState();

    this.init();
  }

  /**
   * Initialize battery monitoring
   */
  private async init(): Promise<void> {
    // Check if Battery Status API is available
    if (
      typeof navigator === 'undefined' ||
      !('getBattery' in navigator)
    ) {
      this.state = 'unavailable';
      return;
    }

    try {
      const battery = await (navigator as any).getBattery();
      this.battery = battery;
      this.updateState();

      // Listen for changes
      battery.addEventListener('chargingchange', this.boundUpdateState);
      battery.addEventListener('levelchange', this.boundUpdateState);
    } catch {
      this.state = 'unavailable';
    }
  }

  /**
   * Update internal state and fire callbacks if changed
   */
  private updateState(): void {
    const battery = this.battery;
    if (!battery || this.isDisposed) return;

    const prevState = this.state;

    if (battery.charging) {
      this.state = 'charging';
    } else if (battery.level <= this.options.criticalThreshold) {
      this.state = 'critical';
    } else if (battery.level <= this.options.lowPowerThreshold) {
      this.state = 'low';
    } else {
      this.state = 'normal';
    }

    if (prevState !== this.state) {
      this.options.onBatteryStateChange(this.state);
      this.listeners.forEach((cb) => {
        try {
          cb(this.state);
        } catch {
          // Ignore listener errors
        }
      });
    }
  }

  /**
   * Get current battery state
   */
  getState(): BatteryState {
    return this.state;
  }

  /**
   * Get current battery level (0-1) or null if unavailable
   */
  getLevel(): number | null {
    return this.battery?.level ?? null;
  }

  /**
   * Check if battery is currently charging
   */
  isCharging(): boolean {
    return this.battery?.charging ?? false;
  }

  /**
   * Check if Battery Status API is available
   */
  isAvailable(): boolean {
    return this.state !== 'unavailable';
  }

  /**
   * Register a callback for state changes
   * @returns Unsubscribe function
   */
  onStateChange(callback: (state: BatteryState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Update thresholds at runtime
   */
  setThresholds(low: number, critical: number): void {
    this.options.lowPowerThreshold = low;
    this.options.criticalThreshold = critical;
    // Re-evaluate state with new thresholds
    if (this.battery) {
      this.updateState();
    }
  }

  /**
   * Get battery info for debugging
   */
  getInfo(): {
    state: BatteryState;
    level: number | null;
    charging: boolean;
    available: boolean;
  } {
    return {
      state: this.state,
      level: this.getLevel(),
      charging: this.isCharging(),
      available: this.isAvailable(),
    };
  }

  /**
   * Clean up event listeners
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.battery) {
      this.battery.removeEventListener('chargingchange', this.boundUpdateState);
      this.battery.removeEventListener('levelchange', this.boundUpdateState);
      this.battery = null;
    }

    this.listeners.clear();
  }
}

/**
 * Global BatteryManager instance
 */
let globalBatteryManager: BatteryManager | null = null;

/**
 * Get the global BatteryManager instance (lazy initialization)
 */
export function getGlobalBatteryManager(): BatteryManager {
  if (!globalBatteryManager) {
    globalBatteryManager = new BatteryManager();
  }
  return globalBatteryManager;
}

/**
 * Replace the global BatteryManager instance
 */
export function setGlobalBatteryManager(manager: BatteryManager): void {
  globalBatteryManager = manager;
}
