import * as THREE from 'three';
import { UserMarker } from './UserMarker';
import { GeolocationProvider } from './GeolocationProvider';
import type { YouAreHereControllerOptions } from './types';

/**
 * Validates that a value is a finite number
 */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * All-in-one controller that manages geolocation + marker together.
 * Handles coordinate conversion, animation loop, and cleanup automatically.
 *
 * Features:
 * - Automatic coordinate conversion from GPS to scene coordinates
 * - Frame-rate independent animation loop
 * - Proper cleanup and resource management
 * - Thread-safe start/stop operations
 *
 * @example
 * ```typescript
 * const controller = new YouAreHereController({
 *   center: [-74.006, 40.7128], // NYC [lng, lat]
 *   markerOptions: { color: 0x4285F4 },
 *   onUpdate: (location) => console.log(location),
 * });
 *
 * await controller.start(scene);
 * // ... later
 * controller.stop(scene);
 * controller.dispose();
 * ```
 */
export class YouAreHereController {
  /** The UserMarker instance - access for customization */
  public readonly marker: UserMarker;

  /** The GeolocationProvider instance - access for advanced control */
  public readonly geolocation: GeolocationProvider;

  private animationId: number | null = null;
  private isStarted = false;
  private isStarting = false; // Mutex for concurrent start() protection
  private isDisposed = false;
  private isStopping = false; // Flag to stop animation loop cleanly
  private currentScene: THREE.Scene | null = null;

  constructor(options: YouAreHereControllerOptions) {
    // Validate required center parameter
    if (!options.center) {
      throw new Error('YouAreHereController: center option is required');
    }

    if (!Array.isArray(options.center) || options.center.length !== 2) {
      throw new Error('YouAreHereController: center must be [longitude, latitude] array');
    }

    const [lng, lat] = options.center;
    if (!isValidNumber(lng) || !isValidNumber(lat)) {
      throw new Error(`YouAreHereController: invalid center coordinates (${lng}, ${lat})`);
    }

    if (options.scale !== undefined && (!isValidNumber(options.scale) || options.scale <= 0)) {
      throw new Error(`YouAreHereController: scale must be a positive number, got: ${options.scale}`);
    }

    // Create marker with projection pre-configured
    this.marker = new UserMarker(options.markerOptions);
    this.marker.setProjectionCenter(options.center, options.scale ?? 1);

    // Create geolocation provider
    this.geolocation = new GeolocationProvider(options.geolocationOptions);

    // Wire up location updates to marker
    this.geolocation.on('update', (location) => {
      if (this.isDisposed) return;

      this.marker.setLatLng(
        location.longitude,
        location.latitude,
        location.altitude ?? 0
      );
      this.marker.setAccuracy(location.accuracy);
      this.marker.setHeading(location.heading, location.speed);
      options.onUpdate?.(location);
    });

    // Wire up error handling
    this.geolocation.on('error', (error) => {
      if (this.isDisposed) return;
      options.onError?.(error as Error);
    });

    // Wire up permission changes
    this.geolocation.on('permissionChange', (state) => {
      if (this.isDisposed) return;
      options.onPermissionChange?.(state);
    });
  }

  /**
   * Add marker to scene and start geolocation tracking + animation loop
   * Thread-safe: concurrent calls are handled properly
   * @param scene The Three.js scene to add the marker to
   */
  async start(scene: THREE.Scene): Promise<void> {
    if (this.isDisposed) {
      throw new Error('YouAreHereController: Cannot start disposed controller');
    }

    // Already started - no-op
    if (this.isStarted) {
      return;
    }

    // Prevent concurrent start() race condition
    if (this.isStarting) {
      // Wait for the existing start to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.isStarting) {
            clearInterval(checkInterval);
            if (this.isStarted) {
              resolve();
            } else {
              reject(new Error('YouAreHereController: Start failed'));
            }
          }
        }, 50);
      });
    }

    this.isStarting = true;

    try {
      this.currentScene = scene;
      scene.add(this.marker);

      // Start geolocation (may throw on permission denied)
      await this.geolocation.start();

      // Only start animation after geolocation succeeds
      this.isStopping = false;
      this.startAnimation();
      this.isStarted = true;
    } catch (error) {
      // Clean up on failure
      scene.remove(this.marker);
      this.currentScene = null;
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop tracking and remove marker from scene
   * @param scene The Three.js scene to remove the marker from (optional if same as start)
   */
  stop(scene?: THREE.Scene): void {
    if (!this.isStarted) return;

    // Signal animation loop to stop
    this.isStopping = true;
    this.stopAnimation();
    this.geolocation.stop();

    // Use provided scene or the one from start()
    const targetScene = scene ?? this.currentScene;
    if (targetScene) {
      targetScene.remove(this.marker);
    }

    this.currentScene = null;
    this.isStarted = false;
  }

  /**
   * Check if controller is currently active
   */
  isActive(): boolean {
    return this.isStarted && !this.isDisposed;
  }

  private startAnimation(): void {
    // Cancel any existing animation loop first
    this.stopAnimation();

    let lastTime = performance.now();

    const animate = () => {
      // Check if we should stop (disposed or stop() called)
      if (this.isDisposed || this.isStopping) {
        this.animationId = null;
        return;
      }

      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Clamp deltaTime to prevent huge jumps if tab was inactive
      const clampedDt = Math.min(dt, 0.1); // Max 100ms

      this.marker.update(clampedDt);
      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  private stopAnimation(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * Clean up all resources (marker, geolocation, animation)
   * After calling dispose(), the controller cannot be reused
   */
  dispose(): void {
    if (this.isDisposed) return;

    this.isDisposed = true;
    this.isStopping = true;
    this.stopAnimation();
    this.geolocation.dispose();
    this.marker.dispose();
    this.currentScene = null;
  }
}
