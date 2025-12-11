import * as THREE from 'three';
import { UserMarker } from './UserMarker';
import { GeolocationProvider } from './GeolocationProvider';
import type { LocationMarkerControllerOptions } from './types';

/**
 * All-in-one controller that manages geolocation + marker together.
 * Handles coordinate conversion, animation loop, and cleanup automatically.
 *
 * @example
 * ```typescript
 * const controller = new LocationMarkerController({
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
export class LocationMarkerController {
  /** The UserMarker instance - access for customization */
  public readonly marker: UserMarker;

  /** The GeolocationProvider instance - access for advanced control */
  public readonly geolocation: GeolocationProvider;

  private animationId: number | null = null;
  private isStarted = false;

  constructor(options: LocationMarkerControllerOptions) {
    // Create marker with projection pre-configured
    this.marker = new UserMarker(options.markerOptions);
    this.marker.setProjectionCenter(options.center, options.scale ?? 1);

    // Create geolocation provider
    this.geolocation = new GeolocationProvider(options.geolocationOptions);

    // Wire up location updates to marker
    this.geolocation.on('update', (location) => {
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
      options.onError?.(error as Error);
    });

    // Wire up permission changes
    this.geolocation.on('permissionChange', (state) => {
      options.onPermissionChange?.(state);
    });
  }

  /**
   * Add marker to scene and start geolocation tracking + animation loop
   * @param scene The Three.js scene to add the marker to
   */
  async start(scene: THREE.Scene): Promise<void> {
    if (this.isStarted) return;

    scene.add(this.marker);
    await this.geolocation.start();
    this.startAnimation();
    this.isStarted = true;
  }

  /**
   * Stop tracking and remove marker from scene
   * @param scene The Three.js scene to remove the marker from
   */
  stop(scene: THREE.Scene): void {
    if (!this.isStarted) return;

    this.stopAnimation();
    this.geolocation.stop();
    scene.remove(this.marker);
    this.isStarted = false;
  }

  /**
   * Check if controller is currently active
   */
  isActive(): boolean {
    return this.isStarted;
  }

  private startAnimation(): void {
    let lastTime = performance.now();

    const animate = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      this.marker.update(dt);
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
   * Call this when completely done with the controller
   */
  dispose(): void {
    this.stopAnimation();
    this.geolocation.dispose();
    this.marker.dispose();
  }
}
