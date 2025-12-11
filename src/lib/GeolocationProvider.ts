import type {
  GeolocationOptions,
  LocationData,
  PermissionState,
  GeolocationEvents
} from './types';

type EventCallback<K extends keyof GeolocationEvents> = (data: GeolocationEvents[K]) => void;

/** Maximum number of listeners per event before warning */
const MAX_LISTENERS_WARNING = 10;

/** Minimum interval between location updates in ms (throttling) */
const MIN_UPDATE_INTERVAL_MS = 100;

const DEFAULT_OPTIONS: Required<GeolocationOptions> = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

/**
 * GeolocationProvider - Wraps browser geolocation API with events and permission handling
 *
 * Features:
 * - Event-based location updates with proper TypeScript types
 * - Permission state tracking (where browser supports it)
 * - Automatic throttling of rapid updates (100ms minimum interval)
 * - Protection against concurrent start() calls
 * - Memory leak prevention with max listener warnings
 * - Last known position storage
 *
 * @example
 * ```typescript
 * const geo = new GeolocationProvider();
 *
 * geo.on('update', (location) => {
 *   console.log(location.latitude, location.longitude);
 *   marker.setPosition(convertToScene(location));
 * });
 *
 * geo.on('error', (error) => {
 *   console.error('Location error:', error.message);
 * });
 *
 * geo.on('permissionChange', (state) => {
 *   console.log('Permission:', state);
 * });
 *
 * await geo.start();
 * ```
 */
export class GeolocationProvider {
  private options: Required<GeolocationOptions>;
  private watchId: number | null = null;
  private permissionState: PermissionState = 'prompt';
  private updateCount = 0;
  private permissionStatus: PermissionStatus | null = null;
  private lastLocation: LocationData | null = null;
  private lastUpdateTime = 0;
  private isStarting = false; // Mutex for concurrent start() protection
  private isDisposed = false;
  private isMocking = false; // When true, mock locations are active
  private mockIntervalId: ReturnType<typeof setInterval> | null = null;

  // Properly typed event listeners
  private listeners: {
    update: Set<EventCallback<'update'>>;
    error: Set<EventCallback<'error'>>;
    permissionChange: Set<EventCallback<'permissionChange'>>;
    deviceOrientation: Set<EventCallback<'deviceOrientation'>>;
  } = {
      update: new Set(),
      error: new Set(),
      permissionChange: new Set(),
      deviceOrientation: new Set(),
    };

  constructor(options: GeolocationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Request permission for iOS 13+ DeviceOrientation events
   * Must be called from a user interaction (click/tap) handler
   */
  static async requestDeviceOrientationPermission(): Promise<PermissionState> {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      (DeviceOrientationEvent as any).requestPermission
    ) {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        return response === 'granted' ? 'granted' : 'denied';
      } catch (error) {
        console.error('Error requesting device orientation permission:', error);
        return 'denied';
      }
    }
    return 'granted'; // Non-iOS or older devices don't need permission
  }

  private handleDeviceOrientation = (event: DeviceOrientationEvent) => {
    this.emit('deviceOrientation', event);
  };

  /**
   * Start watching device orientation (compass)
   */
  startDeviceOrientation(): void {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('deviceorientation', this.handleDeviceOrientation);
    }
  }

  /**
   * Stop watching device orientation
   */
  stopDeviceOrientation(): void {
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('deviceorientation', this.handleDeviceOrientation);
    }
  }

  /**
   * Subscribe to events
   * @returns Unsubscribe function
   */
  on<K extends keyof GeolocationEvents>(
    event: K,
    callback: EventCallback<K>
  ): () => void {
    if (this.isDisposed) {
      console.warn('GeolocationProvider: Cannot add listener to disposed instance');
      return () => { /* no-op */ };
    }

    const listenerSet = this.listeners[event] as Set<EventCallback<K>>;

    // Warn if too many listeners (possible memory leak)
    if (listenerSet.size >= MAX_LISTENERS_WARNING) {
      console.warn(
        `GeolocationProvider: Possible memory leak detected. ` +
        `${listenerSet.size + 1} "${event}" listeners added. ` +
        `Consider removing unused listeners.`
      );
    }

    listenerSet.add(callback);

    // Return unsubscribe function
    return () => {
      listenerSet.delete(callback);
    };
  }

  /**
   * Remove event listener
   */
  off<K extends keyof GeolocationEvents>(
    event: K,
    callback: EventCallback<K>
  ): void {
    const listenerSet = this.listeners[event] as Set<EventCallback<K>>;
    listenerSet.delete(callback);
  }

  /**
   * Remove all listeners for an event, or all events if no event specified
   */
  removeAllListeners(event?: keyof GeolocationEvents): void {
    if (event) {
      this.listeners[event].clear();
    } else {
      this.listeners.update.clear();
      this.listeners.error.clear();
      this.listeners.permissionChange.clear();
      this.listeners.deviceOrientation.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: keyof GeolocationEvents): number {
    return this.listeners[event].size;
  }

  private emit<K extends keyof GeolocationEvents>(
    event: K,
    data: GeolocationEvents[K]
  ): void {
    if (this.isDisposed) return;

    const listenerSet = this.listeners[event] as Set<EventCallback<K>>;
    // Create array copy to safely iterate (listeners might remove themselves)
    const callbacks = Array.from(listenerSet);
    for (const cb of callbacks) {
      try {
        cb(data);
      } catch (err) {
        console.error(`GeolocationProvider: Error in "${event}" listener:`, err);
      }
    }
  }

  private setPermissionState(state: PermissionState): void {
    if (this.permissionState !== state) {
      this.permissionState = state;
      this.emit('permissionChange', state);
    }
  }

  /**
   * Check if geolocation is available in this browser
   */
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  /**
   * Check if running on HTTPS (required for geolocation in modern browsers)
   */
  isSecureContext(): boolean {
    if (typeof window === 'undefined') return false;
    // localhost is considered secure for development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return true;
    }
    return window.location.protocol === 'https:';
  }

  /**
   * Get current permission state
   */
  getPermissionState(): PermissionState {
    return this.permissionState;
  }

  /**
   * Get number of location updates received
   */
  getUpdateCount(): number {
    return this.updateCount;
  }

  /**
   * Get the last received location (null if no updates yet)
   */
  getLastLocation(): LocationData | null {
    return this.lastLocation;
  }

  /**
   * Start watching location
   * Returns a promise that resolves when permission is granted or rejects on error
   *
   * Thread-safe: concurrent calls will return the same promise
   */
  async start(): Promise<void> {
    // Already disposed
    if (this.isDisposed) {
      throw new Error('GeolocationProvider: Cannot start disposed instance');
    }

    // Already watching - no-op
    if (this.watchId !== null) {
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
            reject(new Error('GeolocationProvider: Start timed out waiting for concurrent operation'));
            return;
          }
          if (!this.isStarting) {
            clearInterval(checkInterval);
            if (this.watchId !== null) {
              resolve();
            } else {
              reject(new Error('GeolocationProvider: Start failed'));
            }
          }
        }, 50);
      });
    }

    this.isStarting = true;

    try {
      if (!this.isAvailable()) {
        this.setPermissionState('unavailable');
        const error = new Error('Geolocation is not supported by this browser');
        (error as any).code = 'GEOLOCATION_UNSUPPORTED';
        this.emit('error', error);
        throw error;
      }

      // Check HTTPS requirement
      if (!this.isSecureContext()) {
        console.warn(
          'GeolocationProvider: Geolocation requires HTTPS in modern browsers. ' +
          'Location requests may fail on non-secure origins.'
        );
      }

      // Check permission status if Permissions API is available
      await this.setupPermissionListener();

      this.setPermissionState('requesting');

      return await new Promise<void>((resolve, reject) => {
        let resolved = false;

        this.watchId = navigator.geolocation.watchPosition(
          (position) => {
            this.handlePositionUpdate(position);

            // Resolve on first successful position
            if (!resolved) {
              resolved = true;
              resolve();
            }
          },
          (error) => {
            this.handlePositionError(error);

            // Reject if this is the first call (permission denied or other error)
            if (!resolved) {
              resolved = true;
              reject(error);
            }
          },
          {
            enableHighAccuracy: this.options.enableHighAccuracy,
            maximumAge: this.options.maximumAge,
            timeout: this.options.timeout,
          }
        );
      });
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Setup permission status listener (if Permissions API is available)
   */
  private async setupPermissionListener(): Promise<void> {
    if (!('permissions' in navigator)) {
      return;
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });

      if (result.state === 'denied') {
        this.setPermissionState('denied');
        const error = new Error('Location permission denied');
        this.emit('error', error);
        throw error;
      }

      // Clean up previous listener if exists
      if (this.permissionStatus) {
        this.permissionStatus.onchange = null;
      }

      // Store reference for cleanup and listen for permission changes
      this.permissionStatus = result;
      result.onchange = () => {
        if (this.isDisposed) return;

        if (result.state === 'granted') {
          this.setPermissionState('granted');
        } else if (result.state === 'denied') {
          this.setPermissionState('denied');
          this.stop();
        }
      };
    } catch {
      // Permissions API not fully supported (e.g., Safari < 16)
      // Continue without permission state tracking - geolocation will still work
    }
  }

  /**
   * Handle position update with throttling
   */
  private handlePositionUpdate(position: GeolocationPosition): void {
    const now = Date.now();

    // Throttle updates to prevent performance issues on devices that fire rapidly
    if (now - this.lastUpdateTime < MIN_UPDATE_INTERVAL_MS && this.updateCount > 0) {
      return;
    }

    this.lastUpdateTime = now;
    this.setPermissionState('granted');
    this.updateCount++;

    const locationData: LocationData = {
      longitude: position.coords.longitude,
      latitude: position.coords.latitude,
      altitude: position.coords.altitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed,
      heading: position.coords.heading,
      timestamp: position.timestamp,
    };

    this.lastLocation = locationData;
    this.emit('update', locationData);
  }

  /**
   * Handle position error
   */
  private handlePositionError(error: GeolocationPositionError): void {
    if (error.code === error.PERMISSION_DENIED) {
      this.setPermissionState('denied');
    }

    this.emit('error', error);
  }

  /**
   * Stop watching location
   */
  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Get current position once (not continuous tracking)
   */
  async getCurrentPosition(): Promise<LocationData> {
    if (this.isDisposed) {
      throw new Error('GeolocationProvider: Cannot use disposed instance');
    }

    if (!this.isAvailable()) {
      throw new Error('Geolocation is not supported');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const locationData: LocationData = {
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            altitude: position.coords.altitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp,
          };
          this.lastLocation = locationData;
          resolve(locationData);
        },
        reject,
        {
          enableHighAccuracy: this.options.enableHighAccuracy,
          maximumAge: this.options.maximumAge,
          timeout: this.options.timeout,
        }
      );
    });
  }

  /**
   * Check if currently watching
   */
  isWatching(): boolean {
    return this.watchId !== null || this.isMocking;
  }

  /**
   * Check if mock mode is active
   */
  isMockMode(): boolean {
    return this.isMocking;
  }

  /**
   * Set a mock location for testing/demo purposes
   * This emits a location update event with the provided coordinates
   *
   * @param location The mock location data
   * @example
   * ```typescript
   * geo.setMockLocation({
   *   longitude: -74.006,
   *   latitude: 40.7128,
   *   altitude: 10,
   *   accuracy: 5,
   *   speed: 1.5,
   *   heading: 90,
   *   timestamp: Date.now()
   * });
   * ```
   */
  setMockLocation(location: LocationData): void {
    if (this.isDisposed) {
      console.warn('GeolocationProvider: Cannot set mock location on disposed instance');
      return;
    }

    this.isMocking = true;
    this.setPermissionState('granted');

    // Simulate the position update flow
    const now = Date.now();
    this.lastUpdateTime = now;
    this.updateCount++;

    // Use provided timestamp or current time
    const locationWithTimestamp: LocationData = {
      ...location,
      timestamp: location.timestamp ?? now
    };

    this.lastLocation = locationWithTimestamp;
    this.emit('update', locationWithTimestamp);
  }

  /**
   * Start a mock location simulation that moves along a path
   * Useful for demos and testing movement scenarios
   *
   * @param locations Array of locations to cycle through
   * @param intervalMs Time between location updates in milliseconds (default: 1000)
   * @returns Function to stop the simulation
   *
   * @example
   * ```typescript
   * const stopMock = geo.startMockPath([
   *   { longitude: -74.006, latitude: 40.7128, accuracy: 5, speed: 1.5, heading: 90 },
   *   { longitude: -74.005, latitude: 40.7130, accuracy: 5, speed: 1.5, heading: 45 },
   * ], 1000);
   *
   * // Later, stop the simulation
   * stopMock();
   * ```
   */
  startMockPath(locations: Partial<LocationData>[], intervalMs: number = 1000): () => void {
    if (this.isDisposed) {
      console.warn('GeolocationProvider: Cannot start mock path on disposed instance');
      return () => {};
    }

    if (!locations || locations.length === 0) {
      console.warn('GeolocationProvider: Mock path requires at least one location');
      return () => {};
    }

    // Stop any existing mock simulation
    this.stopMockPath();

    this.isMocking = true;
    this.setPermissionState('granted');

    let index = 0;
    const emitLocation = () => {
      const partial = locations[index];
      const location: LocationData = {
        longitude: partial.longitude ?? 0,
        latitude: partial.latitude ?? 0,
        altitude: partial.altitude ?? null,
        accuracy: partial.accuracy ?? 10,
        speed: partial.speed ?? null,
        heading: partial.heading ?? null,
        timestamp: Date.now()
      };

      this.setMockLocation(location);
      index = (index + 1) % locations.length; // Loop back to start
    };

    // Emit first location immediately
    emitLocation();

    // Continue emitting at interval
    this.mockIntervalId = setInterval(emitLocation, intervalMs);

    // Return stop function
    return () => this.stopMockPath();
  }

  /**
   * Stop mock path simulation
   */
  stopMockPath(): void {
    if (this.mockIntervalId !== null) {
      clearInterval(this.mockIntervalId);
      this.mockIntervalId = null;
    }
  }

  /**
   * Exit mock mode and return to real geolocation
   * Note: You'll need to call start() again to resume real tracking
   */
  stopMocking(): void {
    this.stopMockPath();
    this.isMocking = false;
  }

  /**
   * Clear the cached last location
   * Useful for privacy when the user logs out or for testing
   */
  clearLastLocation(): void {
    this.lastLocation = null;
  }

  /**
   * Clean up all resources and listeners
   * After calling dispose(), the instance cannot be reused
   */
  dispose(): void {
    if (this.isDisposed) return;

    this.isDisposed = true;
    this.stop();
    this.stopMockPath();
    this.isMocking = false;

    // Clean up permission status listener to prevent memory leak
    if (this.permissionStatus) {
      this.permissionStatus.onchange = null;
      this.permissionStatus = null;
    }

    // Clear all listeners
    this.listeners.update.clear();
    this.listeners.error.clear();
    this.listeners.permissionChange.clear();
    this.listeners.deviceOrientation.clear();
    this.stopDeviceOrientation();

    this.lastLocation = null;
  }
}

