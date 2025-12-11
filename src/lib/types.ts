import type * as THREE from 'three';

/**
 * Configuration options for UserMarker
 */
export interface UserMarkerOptions {
  /** Main color of the marker (default: 0x4285F4 - Google blue) */
  color?: number;
  
  /** Border/outline color (default: 0xffffff) */
  borderColor?: number;
  
  /** Size of the dot in scene units (default: 9) */
  dotSize?: number;
  
  /** Border width relative to dot size (default: 3) */
  borderWidth?: number;
  
  /** Show the accuracy ring (default: true) */
  showAccuracyRing?: boolean;
  
  /** Show direction cone when moving (default: true) */
  showDirectionCone?: boolean;
  
  /** Minimum speed (m/s) to show direction cone (default: 0.5) */
  minSpeedForDirection?: number;
  
  /** Length of the direction cone (default: 45) */
  coneLength?: number;
  
  /** Width of the direction cone at the end (default: 70) */
  coneWidth?: number;
  
  /** Opacity of the direction cone (default: 0.2) */
  coneOpacity?: number;
  
  /** Accuracy ring color (default: same as color) */
  accuracyRingColor?: number;
  
  /** Enable smooth position interpolation (default: true) */
  smoothPosition?: boolean;
  
  /** Enable smooth heading interpolation (default: true) */
  smoothHeading?: boolean;
  
  /** Position interpolation speed 0-1 (default: 0.03) */
  positionSmoothingFactor?: number;
  
  /** Heading interpolation speed 0-1 (default: 0.15) */
  headingSmoothingFactor?: number;
}

/**
 * Location update data
 */
export interface LocationData {
  /** Longitude in degrees */
  longitude: number;
  
  /** Latitude in degrees */
  latitude: number;
  
  /** Altitude in meters (may be null) */
  altitude: number | null;
  
  /** Accuracy in meters */
  accuracy: number;
  
  /** Speed in m/s (may be null) */
  speed: number | null;
  
  /** Heading in degrees from north, clockwise (may be null) */
  heading: number | null;
  
  /** Timestamp of the reading */
  timestamp: number;
}

/**
 * Scene position (after coordinate conversion)
 */
export interface ScenePosition {
  x: number;
  y: number;
  z?: number;
}

/**
 * Geolocation provider options
 */
export interface GeolocationOptions {
  /** Use high accuracy mode (default: true) */
  enableHighAccuracy?: boolean;
  
  /** Maximum age of cached position in ms (default: 0) */
  maximumAge?: number;
  
  /** Timeout for position request in ms (default: 10000) */
  timeout?: number;
}

/**
 * Permission states
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable' | 'requesting';

/**
 * Event types emitted by GeolocationProvider
 */
export interface GeolocationEvents {
  update: LocationData;
  error: GeolocationPositionError | Error;
  permissionChange: PermissionState;
}

/**
 * Coordinate converter interface - implement this to convert lat/lng to your scene coordinates
 */
export interface CoordinateConverter {
  /** Convert longitude/latitude to scene X/Y coordinates */
  toScene(longitude: number, latitude: number, altitude?: number): ScenePosition;

  /** Convert scene X/Y back to longitude/latitude (optional) */
  fromScene?(x: number, y: number): { longitude: number; latitude: number };
}

/**
 * Options for LocationMarkerController
 */
export interface LocationMarkerControllerOptions {
  /** Options for the UserMarker visual */
  markerOptions?: UserMarkerOptions;

  /** Options for the GeolocationProvider */
  geolocationOptions?: GeolocationOptions;

  /** Venue/map center [longitude, latitude] - required for coordinate conversion */
  center: [number, number];

  /** Scale factor for coordinate conversion (default: 1) */
  scale?: number;

  /** Called on each location update */
  onUpdate?: (location: LocationData) => void;

  /** Called on geolocation errors */
  onError?: (error: Error) => void;

  /** Called when permission state changes */
  onPermissionChange?: (state: PermissionState) => void;
}
