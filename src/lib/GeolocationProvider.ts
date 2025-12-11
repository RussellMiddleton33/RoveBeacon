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

  // Properly typed event listeners
  private listeners: {
    update: Set<EventCallback<'update'>>;
    error: Set<EventCallback<'error'>>;
    permissionChange: Set<EventCallback<'permissionChange'>>;
  } = {
      update: new Set(),
      error: new Set(),
      permissionChange: new Set(),
    };

  constructor(options: GeolocationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
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
      // Wait for the existing start to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
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
    return this.watchId !== null;
  }

  /**
   * Clean up all resources and listeners
   * After calling dispose(), the instance cannot be reused
   */
  dispose(): void {
    if (this.isDisposed) return;

    this.isDisposed = true;
    this.stop();

    // Clean up permission status listener to prevent memory leak
    if (this.permissionStatus) {
      this.permissionStatus.onchange = null;
      this.permissionStatus = null;
    }

    // Clear all listeners
    this.listeners.update.clear();
    this.listeners.error.clear();
    this.listeners.permissionChange.clear();

    this.lastLocation = null;
  }
}

