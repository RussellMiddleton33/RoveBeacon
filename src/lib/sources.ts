import type { LocationData, PermissionState, GeolocationEvents } from './types';

/**
 * Interface for any source of location data.
 * Implement this to create custom providers (e.g., ReplaySource, WebSocketSource).
 */
export interface LocationSource {
  /**
   * Start receiving location updates
   */
  start(): Promise<void>;

  /**
   * Stop receiving location updates
   */
  stop(): void;

  /**
   * Get the most recently received location
   */
  getLastLocation(): LocationData | null;

  /**
   * Get the current permission state of the source
   */
  getPermissionState(): PermissionState;

  /**
   * Subscribe to events
   */
  on<K extends keyof GeolocationEvents>(event: K, callback: (data: GeolocationEvents[K]) => void): () => void;
  
  /**
   * Remove event listener
   */
  off<K extends keyof GeolocationEvents>(event: K, callback: (data: GeolocationEvents[K]) => void): void;

  /**
   * Clean up resources
   */
  dispose(): void;
}
