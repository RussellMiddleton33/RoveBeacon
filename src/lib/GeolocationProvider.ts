import type {
  GeolocationOptions,
  LocationData,
  PermissionState,
  GeolocationEvents
} from './types';

type EventCallback<T> = (data: T) => void;

const DEFAULT_OPTIONS: Required<GeolocationOptions> = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

/**
 * GeolocationProvider - Wraps browser geolocation API with events and permission handling
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

  // Event listeners
  private listeners: {
    update: EventCallback<LocationData>[];
    error: EventCallback<GeolocationPositionError | Error>[];
    permissionChange: EventCallback<PermissionState>[];
  } = {
      update: [],
      error: [],
      permissionChange: [],
    };

  constructor(options: GeolocationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Subscribe to events
   */
  on<K extends keyof GeolocationEvents>(
    event: K,
    callback: EventCallback<GeolocationEvents[K]>
  ): () => void {
    this.listeners[event].push(callback as any);

    // Return unsubscribe function
    return () => {
      const index = this.listeners[event].indexOf(callback as any);
      if (index > -1) {
        this.listeners[event].splice(index, 1);
      }
    };
  }

  /**
   * Remove event listener
   */
  off<K extends keyof GeolocationEvents>(
    event: K,
    callback: EventCallback<GeolocationEvents[K]>
  ): void {
    const index = this.listeners[event].indexOf(callback as any);
    if (index > -1) {
      this.listeners[event].splice(index, 1);
    }
  }

  private emit<K extends keyof GeolocationEvents>(
    event: K,
    data: GeolocationEvents[K]
  ): void {
    this.listeners[event].forEach((cb: any) => cb(data));
  }

  private setPermissionState(state: PermissionState): void {
    if (this.permissionState !== state) {
      this.permissionState = state;
      this.emit('permissionChange', state);
    }
  }

  /**
   * Check if geolocation is available
   */
  isAvailable(): boolean {
    return 'geolocation' in navigator;
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
   * Start watching location
   * Returns a promise that resolves when permission is granted or rejects on error
   */
  async start(): Promise<void> {
    if (!this.isAvailable()) {
      this.setPermissionState('unavailable');
      const error = new Error('Geolocation is not supported by this browser');
      this.emit('error', error);
      throw error;
    }

    // Prevent multiple watches
    if (this.watchId !== null) {
      this.stop();
    }

    // Check permission status if available
    if ('permissions' in navigator) {
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
          if (result.state === 'granted') {
            this.setPermissionState('granted');
          } else if (result.state === 'denied') {
            this.setPermissionState('denied');
            this.stop();
          }
        };
      } catch (e) {
        // Permissions API not fully supported, continue anyway
        // Silent fallback - no console logging in production
      }
    }

    this.setPermissionState('requesting');

    return new Promise((resolve, reject) => {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
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

          this.emit('update', locationData);

          // Resolve on first successful position
          if (this.updateCount === 1) {
            resolve();
          }
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            this.setPermissionState('denied');
          }

          this.emit('error', error);

          // Reject if this is the first call (permission denied)
          if (this.updateCount === 0) {
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
    if (!this.isAvailable()) {
      throw new Error('Geolocation is not supported');
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            altitude: position.coords.altitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: position.timestamp,
          });
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
   */
  dispose(): void {
    this.stop();

    // Clean up permission status listener to prevent memory leak
    if (this.permissionStatus) {
      this.permissionStatus.onchange = null;
      this.permissionStatus = null;
    }

    this.listeners = {
      update: [],
      error: [],
      permissionChange: [],
    };
  }
}

