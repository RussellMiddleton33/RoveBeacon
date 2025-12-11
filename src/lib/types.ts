/**
 * Confidence state for GPS signal quality
 *
 * - 'high': Good GPS signal, accurate position
 * - 'low': Degraded signal, position may be less accurate
 * - 'lost': No GPS signal, showing last known position
 */
export type ConfidenceState = 'high' | 'low' | 'lost';

/**
 * Configuration options for UserMarker
 *
 * All size values are in scene units (not pixels).
 * Color values are hex numbers (e.g., 0x4285F4).
 */
export interface UserMarkerOptions {
  /**
   * Main color of the marker dot and cone
   * @default 0x4285F4 (Google blue)
   */
  color?: number;

  /**
   * Border/outline color around the dot
   * @default 0xffffff (white)
   */
  borderColor?: number;

  /**
   * Radius of the center dot in scene units
   * @default 9
   */
  dotSize?: number;

  /**
   * Width of the border around the dot in scene units
   * @default 3
   */
  borderWidth?: number;

  /**
   * Whether to show the pulsing accuracy ring
   * @default true
   */
  showAccuracyRing?: boolean;

  /**
   * Whether to show the direction cone when user is moving
   * @default true
   */
  showDirectionCone?: boolean;

  /**
   * Minimum speed in m/s required to show direction cone
   * Prevents cone from appearing when user is stationary
   * @default 0.5
   */
  minSpeedForDirection?: number;

  /**
   * Length of the direction cone in scene units
   * @default 45
   */
  coneLength?: number;

  /**
   * Width of the direction cone at its widest point in scene units
   * @default 70
   */
  coneWidth?: number;

  /**
   * Opacity of the direction cone (0-1)
   * @default 0.2
   */
  coneOpacity?: number;

  /**
   * Color of the accuracy ring (defaults to main color)
   * @default Same as color
   */
  accuracyRingColor?: number;

  /**
   * Enable smooth position interpolation when location updates
   * @default true
   */
  smoothPosition?: boolean;

  /**
   * Enable smooth heading interpolation when direction changes
   * @default true
   */
  smoothHeading?: boolean;

  /**
   * Position interpolation speed factor (0-1)
   * Higher values = faster interpolation
   * @default 0.03
   */
  positionSmoothingFactor?: number;

  /**
   * Heading interpolation speed factor (0-1)
   * Higher values = faster interpolation
   * @default 0.15
   */
  headingSmoothingFactor?: number;

  /**
   * Coordinate system orientation
   * - 'z-up': Z axis points up (common in mapping applications)
   * - 'y-up': Y axis points up (standard Three.js convention)
   * @default 'z-up'
   */
  orientation?: 'z-up' | 'y-up';

  /**
   * Enable automatic confidence state based on staleness and accuracy
   * When enabled, confidence will automatically degrade to 'low' or 'lost'
   * based on time since last update and GPS accuracy
   * @default true
   */
  enableAutoConfidence?: boolean;

  /**
   * Time in milliseconds after which confidence degrades to 'low'
   * @default 30000 (30 seconds)
   */
  stalenessLowThresholdMs?: number;

  /**
   * Time in milliseconds after which confidence degrades to 'lost'
   * @default 60000 (60 seconds)
   */
  stalenessLostThresholdMs?: number;

  /**
   * Accuracy in meters above which confidence degrades to 'low'
   * @default 100
   */
  accuracyLowThresholdMeters?: number;

  /**
   * Accuracy in meters above which confidence degrades to 'lost'
   * @default 500
   */
  accuracyLostThresholdMeters?: number;
}

/**
 * Location data received from the Geolocation API
 *
 * All coordinates are in WGS84 (standard GPS coordinates).
 */
export interface LocationData {
  /**
   * Longitude in degrees (-180 to 180)
   * Negative values are west of the Prime Meridian
   */
  longitude: number;

  /**
   * Latitude in degrees (-90 to 90)
   * Negative values are south of the Equator
   */
  latitude: number;

  /**
   * Altitude in meters above the WGS84 ellipsoid
   * May be null if the device doesn't support altitude
   */
  altitude: number | null;

  /**
   * Accuracy of the position in meters
   * Represents the radius of a circle within which the true position lies
   */
  accuracy: number;

  /**
   * Speed in meters per second
   * May be null if the device doesn't support speed
   */
  speed: number | null;

  /**
   * Heading in degrees from true north (0-360), clockwise
   * 0 = North, 90 = East, 180 = South, 270 = West
   * May be null if the device doesn't support heading or user is stationary
   */
  heading: number | null;

  /**
   * Timestamp of when this reading was taken
   * Milliseconds since Unix epoch (Date.now() format)
   */
  timestamp: number;
}

/**
 * Position in Three.js scene coordinates
 */
export interface ScenePosition {
  /** X coordinate in scene units */
  x: number;
  /** Y coordinate in scene units */
  y: number;
  /** Z coordinate in scene units (altitude) */
  z?: number;
}

/**
 * Options for the GeolocationProvider
 *
 * These options are passed directly to the browser's Geolocation API.
 */
export interface GeolocationOptions {
  /**
   * Use high accuracy mode (GPS vs cell tower/WiFi)
   * High accuracy uses more battery but provides better precision
   * @default true
   */
  enableHighAccuracy?: boolean;

  /**
   * Maximum age of a cached position to accept in milliseconds
   * Set to 0 to always get a fresh position
   * @default 0
   */
  maximumAge?: number;

  /**
   * Maximum time to wait for a position in milliseconds
   * @default 10000 (10 seconds)
   */
  timeout?: number;
}

/**
 * Permission states for geolocation access
 *
 * - 'prompt': User hasn't been asked yet
 * - 'granted': User has granted permission
 * - 'denied': User has denied permission
 * - 'unavailable': Geolocation is not available (e.g., no GPS hardware)
 * - 'requesting': Currently requesting permission from user
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable' | 'requesting';

/**
 * Event types emitted by GeolocationProvider
 *
 * Use with GeolocationProvider.on() to listen for events.
 */
export interface GeolocationEvents {
  /** Fired when a new location is received */
  update: LocationData;
  /** Fired when a geolocation error occurs */
  error: GeolocationPositionError | Error;
  /** Fired when the permission state changes */
  permissionChange: PermissionState;
  /** Fired when device orientation changes (compass) */
  deviceOrientation: DeviceOrientationEvent;
}

/**
 * Interface for custom coordinate conversion implementations
 *
 * Implement this interface to use a custom projection system
 * instead of the built-in Web Mercator projection.
 */
export interface CoordinateConverter {
  /**
   * Convert WGS84 coordinates to scene coordinates
   * @param longitude Longitude in degrees
   * @param latitude Latitude in degrees
   * @param altitude Altitude in meters (optional)
   * @returns Scene position object
   */
  toScene(longitude: number, latitude: number, altitude?: number): ScenePosition;

  /**
   * Convert scene coordinates back to WGS84 (optional)
   * @param x Scene X coordinate
   * @param y Scene Y coordinate
   * @returns Object with longitude and latitude
   */
  fromScene?(x: number, y: number): { longitude: number; latitude: number };
}

/**
 * Options for YouAreHereController
 *
 * The controller combines UserMarker and GeolocationProvider into
 * a single, easy-to-use interface with automatic coordinate conversion.
 */
export interface YouAreHereControllerOptions {
  /**
   * Options for the UserMarker visual appearance
   */
  markerOptions?: UserMarkerOptions;

  /**
   * Options for the GeolocationProvider
   */
  geolocationOptions?: GeolocationOptions;

  /**
   * Center point for coordinate conversion [longitude, latitude]
   *
   * This should be the center of your venue/map. All GPS coordinates
   * will be converted to scene coordinates relative to this point.
   *
   * @required
   * @example [-74.006, 40.7128] // New York City
   */
  center: [number, number];

  /**
   * Scale factor for coordinate conversion
   *
   * Adjust this to match your scene's coordinate system.
   * Larger values = larger scene coordinates for the same GPS distance.
   *
   * @default 1
   */
  scale?: number;

  /**
   * Callback fired on each location update
   * @param location The new location data
   */
  onUpdate?: (location: LocationData) => void;

  /**
   * Callback fired on geolocation errors
   * @param error The error that occurred
   */
  onError?: (error: Error) => void;

  /**
   * Callback fired when permission state changes
   * @param state The new permission state
   */
  onPermissionChange?: (state: PermissionState) => void;

  /**
   * Enable device compass (magnetometer) integration
   * 
   * If true, the SDK will listen for device orientation events to rotate the marker
   * when stationary. On iOS, this requires calling `requestPermissions()` from a user action.
   * 
   * @default true
   */
  enableCompass?: boolean;
}
