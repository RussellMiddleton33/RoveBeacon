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

  private options: YouAreHereControllerOptions;

  private animationId: number | null = null;
  private isStarted = false;
  private isStarting = false; // Mutex for concurrent start() protection
  private isDisposed = false;
  private isStopping = false; // Flag to stop animation loop cleanly
  private currentScene: THREE.Scene | null = null;

  constructor(options: YouAreHereControllerOptions) {
    this.options = options;

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

      const [x, y, z] = this.marker.getProjection()?.lngLatToScene(
        location.longitude,
        location.latitude,
        location.altitude ?? 0
      ) ?? [0, 0, 0];

      // Handle coordinate system based on marker orientation
      if (options.markerOptions?.orientation === 'y-up') {
        // Standard Three.js: Y is up, -Z is North
        // Map data: x=East, y=North, z=Altitude
        // We map: x->x, y->-z, z->y
        this.marker.setPosition(x, z, -y);
      } else {
        // Z-up (MapLibre/GIS default): x=East, y=North, z=Up
        this.marker.setPosition(x, y, z);
      }
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

    // Wire up device orientation (compass)
    this.geolocation.on('deviceOrientation', (event) => {
      if (this.isDisposed) return;

      // Calculate compass heading: 
      // alpha is 0-360 degrees around z-axis (compass heading)
      // Note: This is a simplified implementation. Real-world compass 
      // handling needs to account for screen orientation and declination.
      // But for basic "phone pointing this way", alpha is usually sufficient 
      // on modern browsers which often compensate for screen rotation automatically.
      // Or we should check `event.webkitCompassHeading` for iOS.

      let heading: number | null = null;

      if ((event as any).webkitCompassHeading) {
        // iOS
        heading = (event as any).webkitCompassHeading;
      } else if (event.alpha !== null) {
        // Android / Standard
        // alpha increases counter-clockwise on some devices? Standard says 0=North, increasing counter-clockwise?
        // Actually MDN says: 0 is North, increasing when rotating device counter-clockwise (so East is 270?).
        // Compass heading usually means 0=N, 90=E.
        // If alpha is counter-clockwise: Heading = 360 - alpha.
        heading = 360 - event.alpha;
      }

      this.marker.setDeviceHeading(heading);
    });
  }

  /**
   * Request necessary permissions (specifically Compass on iOS 13+).
   * Call this from a user interaction event handler (like a button click).
   * 
   * On iOS, this triggers the "Allow access to Motion & Orientation?" prompt.
   * On Android/Desktop, this is usually a no-op (resolves immediately).
   */
  async requestPermissions(): Promise<void> {
    if (this.options.enableCompass !== false) {
      await GeolocationProvider.requestDeviceOrientationPermission();
    }
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
      // Wait for the existing start to complete (with timeout)
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // 5 second timeout (100 * 50ms)
        const checkInterval = setInterval(() => {
          attempts++;
          if (attempts > maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error('YouAreHereController: Start timed out waiting for concurrent operation'));
            return;
          }
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

      // Start compass listener (no-op if not supported)
      // Only if enabled in options (default: true)
      if (this.options.enableCompass !== false) {
        this.geolocation.startDeviceOrientation();
      }

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
    this.geolocation.stopDeviceOrientation();

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
