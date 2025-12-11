/**
 * FrameMonitor - Performance monitoring for animation loops
 *
 * Tracks frame times and FPS, with callbacks when performance degrades.
 * Useful for adaptive quality adjustments on mobile devices.
 */

export interface FrameMonitorOptions {
  /**
   * Target frame time in milliseconds
   * @default 16.67 (60 FPS)
   */
  targetFrameTime?: number;

  /**
   * Number of frames to average for metrics
   * @default 30
   */
  sampleSize?: number;

  /**
   * Threshold multiplier to trigger performance warning
   * Warning fires when avgFrameTime > targetFrameTime * warningThreshold
   * @default 1.5
   */
  warningThreshold?: number;

  /**
   * Minimum interval between warning callbacks (ms)
   * Prevents spam when performance is consistently bad
   * @default 5000
   */
  warningCooldownMs?: number;

  /**
   * Callback when frame budget is exceeded
   */
  onPerformanceWarning?: (stats: FrameStats) => void;

  /**
   * Callback when performance recovers to acceptable levels
   */
  onPerformanceRecovered?: (stats: FrameStats) => void;
}

export interface FrameStats {
  /** Average frame time in milliseconds */
  avgFrameTime: number;

  /** Current FPS based on average frame time */
  fps: number;

  /** Number of frames that exceeded 2x target (dropped frames) */
  droppedFrames: number;

  /** Total frames sampled */
  totalFrames: number;

  /** Worst frame time in the sample window */
  worstFrameTime: number;

  /** Best frame time in the sample window */
  bestFrameTime: number;
}

/**
 * Monitors frame performance and triggers callbacks on degradation
 *
 * @example
 * ```typescript
 * const monitor = new FrameMonitor({
 *   onPerformanceWarning: (stats) => {
 *     console.log(`Low FPS: ${stats.fps.toFixed(1)}`);
 *     qualityManager.setPreset('low');
 *   },
 * });
 *
 * function animate(timestamp: number) {
 *   monitor.tick(timestamp);
 *   // ... render
 *   requestAnimationFrame(animate);
 * }
 * ```
 */
export class FrameMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private droppedFrames = 0;
  private totalFrames = 0;
  private worstFrameTime = 0;
  private bestFrameTime = Infinity;
  private lastWarningTime = 0;
  private isInWarningState = false;

  private options: Required<FrameMonitorOptions>;

  constructor(options: FrameMonitorOptions = {}) {
    this.options = {
      targetFrameTime: 16.67,
      sampleSize: 30,
      warningThreshold: 1.5,
      warningCooldownMs: 5000,
      onPerformanceWarning: () => {},
      onPerformanceRecovered: () => {},
      ...options,
    };
  }

  /**
   * Record a frame tick
   * Call this at the start of each animation frame
   *
   * @param timestamp Current timestamp from requestAnimationFrame
   */
  tick(timestamp: number): void {
    if (this.lastFrameTime > 0) {
      const frameTime = timestamp - this.lastFrameTime;

      // Add to samples
      this.frameTimes.push(frameTime);
      this.totalFrames++;

      // Track min/max
      if (frameTime > this.worstFrameTime) {
        this.worstFrameTime = frameTime;
      }
      if (frameTime < this.bestFrameTime) {
        this.bestFrameTime = frameTime;
      }

      // Track dropped frames (>2x target)
      if (frameTime > this.options.targetFrameTime * 2) {
        this.droppedFrames++;
      }

      // Keep only recent samples
      if (this.frameTimes.length > this.options.sampleSize) {
        this.frameTimes.shift();
      }

      // Check threshold after we have enough samples
      if (this.frameTimes.length >= this.options.sampleSize) {
        this.checkThreshold(timestamp);
      }
    }

    this.lastFrameTime = timestamp;
  }

  /**
   * Check if we should fire warning/recovery callbacks
   */
  private checkThreshold(now: number): void {
    const avg = this.getAverageFrameTime();
    const threshold = this.options.targetFrameTime * this.options.warningThreshold;

    if (avg > threshold) {
      // Performance is bad
      if (!this.isInWarningState) {
        this.isInWarningState = true;
        this.lastWarningTime = now;
        this.options.onPerformanceWarning(this.getStats());
      } else if (now - this.lastWarningTime > this.options.warningCooldownMs) {
        // Still bad after cooldown, fire again
        this.lastWarningTime = now;
        this.options.onPerformanceWarning(this.getStats());
      }
    } else {
      // Performance is good
      if (this.isInWarningState) {
        this.isInWarningState = false;
        this.options.onPerformanceRecovered(this.getStats());
      }
    }
  }

  /**
   * Get average frame time in milliseconds
   */
  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    const sum = this.frameTimes.reduce((a, b) => a + b, 0);
    return sum / this.frameTimes.length;
  }

  /**
   * Get current FPS based on average frame time
   */
  getFPS(): number {
    const avg = this.getAverageFrameTime();
    return avg > 0 ? 1000 / avg : 0;
  }

  /**
   * Get comprehensive frame statistics
   */
  getStats(): FrameStats {
    return {
      avgFrameTime: this.getAverageFrameTime(),
      fps: this.getFPS(),
      droppedFrames: this.droppedFrames,
      totalFrames: this.totalFrames,
      worstFrameTime: this.worstFrameTime === 0 ? 0 : this.worstFrameTime,
      bestFrameTime: this.bestFrameTime === Infinity ? 0 : this.bestFrameTime,
    };
  }

  /**
   * Check if currently in warning state
   */
  isWarning(): boolean {
    return this.isInWarningState;
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.frameTimes = [];
    this.droppedFrames = 0;
    this.totalFrames = 0;
    this.worstFrameTime = 0;
    this.bestFrameTime = Infinity;
    this.lastFrameTime = 0;
    this.isInWarningState = false;
  }

  /**
   * Update target frame time (e.g., for 30fps mode)
   */
  setTargetFrameTime(ms: number): void {
    this.options.targetFrameTime = ms;
  }

  /**
   * Update warning threshold
   */
  setWarningThreshold(multiplier: number): void {
    this.options.warningThreshold = multiplier;
  }
}
