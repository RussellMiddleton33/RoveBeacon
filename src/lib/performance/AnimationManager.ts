/**
 * AnimationManager - Shared animation loop for multiple markers
 *
 * Instead of each controller running its own requestAnimationFrame,
 * this singleton batches all updates into a single frame callback.
 * Reduces overhead when multiple markers are active.
 */

import { FrameMonitor, type FrameStats } from './FrameMonitor';

/**
 * Callback signature for animation updates
 * @param deltaTime Time since last frame in seconds (clamped to 0.1 max)
 */
export type AnimationCallback = (deltaTime: number) => void;

/**
 * Options for the AnimationManager
 */
export interface AnimationManagerOptions {
  /**
   * Enable frame monitoring
   * @default false
   */
  enableMonitoring?: boolean;

  /**
   * Callback when frame budget is exceeded
   */
  onPerformanceWarning?: (stats: FrameStats) => void;

  /**
   * Callback when performance recovers
   */
  onPerformanceRecovered?: (stats: FrameStats) => void;
}

/**
 * Singleton animation manager for batched updates
 *
 * @example
 * ```typescript
 * const unregister = AnimationManager.register((dt) => {
 *   marker.update(dt);
 * });
 *
 * // Later, when done:
 * unregister();
 * ```
 */
class AnimationManagerSingleton {
  private callbacks: Map<symbol, AnimationCallback> = new Map();
  private animationId: number | null = null;
  private lastTime = 0;
  private frameMonitor: FrameMonitor | null = null;
  private options: AnimationManagerOptions = {};

  /**
   * Configure the animation manager
   * Should be called before registering any callbacks
   */
  configure(options: AnimationManagerOptions): void {
    this.options = options;

    if (options.enableMonitoring) {
      this.frameMonitor = new FrameMonitor({
        onPerformanceWarning: options.onPerformanceWarning,
        onPerformanceRecovered: options.onPerformanceRecovered,
      });
    } else {
      this.frameMonitor = null;
    }
  }

  /**
   * Register an animation callback
   * Returns an unregister function
   *
   * @param callback Function to call each frame with deltaTime
   * @returns Unregister function - call to remove the callback
   */
  register(callback: AnimationCallback): () => void {
    const id = Symbol('animation-callback');
    this.callbacks.set(id, callback);

    // Start loop if this is the first callback
    if (this.callbacks.size === 1) {
      this.start();
    }

    // Return unregister function
    return () => {
      this.callbacks.delete(id);

      // Stop loop if no more callbacks
      if (this.callbacks.size === 0) {
        this.stop();
      }
    };
  }

  /**
   * Check if animation loop is running
   */
  isRunning(): boolean {
    return this.animationId !== null;
  }

  /**
   * Get number of registered callbacks
   */
  getCallbackCount(): number {
    return this.callbacks.size;
  }

  /**
   * Get frame statistics (if monitoring enabled)
   */
  getStats(): FrameStats | null {
    return this.frameMonitor?.getStats() ?? null;
  }

  /**
   * Get current FPS (if monitoring enabled)
   */
  getFPS(): number {
    return this.frameMonitor?.getFPS() ?? 0;
  }

  /**
   * Start the animation loop
   */
  private start(): void {
    if (this.animationId !== null) return;

    this.lastTime = performance.now();
    this.frameMonitor?.reset();

    const animate = (timestamp: number) => {
      // Calculate delta time in seconds
      const dt = (timestamp - this.lastTime) / 1000;
      this.lastTime = timestamp;

      // Clamp to prevent huge jumps (e.g., after tab was inactive)
      const clampedDt = Math.min(dt, 0.1);

      // Update frame monitor
      this.frameMonitor?.tick(timestamp);

      // Call all registered callbacks
      // Use Array.from to safely iterate (callbacks might unregister themselves)
      const callbacksArray = Array.from(this.callbacks.values());
      for (const callback of callbacksArray) {
        try {
          callback(clampedDt);
        } catch (error) {
          console.error('[AnimationManager] Callback error:', error);
        }
      }

      // Continue loop if we still have callbacks
      if (this.callbacks.size > 0) {
        this.animationId = requestAnimationFrame(animate);
      } else {
        this.animationId = null;
      }
    };

    this.animationId = requestAnimationFrame(animate);
  }

  /**
   * Stop the animation loop
   */
  private stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Force stop and clear all callbacks
   * Use for cleanup/testing
   */
  reset(): void {
    this.stop();
    this.callbacks.clear();
    this.frameMonitor?.reset();
  }
}

// Export singleton instance
export const AnimationManager = new AnimationManagerSingleton();

// Also export the class for testing or multiple instances
export { AnimationManagerSingleton };
