// Three.js SDK exports
export { ThreeUserMarker } from './ThreeUserMarker';
export { ThreeYouAreHereController } from './ThreeYouAreHereController';

// Re-export shared types and utilities
export { GeolocationProvider } from '../GeolocationProvider';
export { MercatorProjection } from '../../utils/MercatorProjection';
export type {
  UserMarkerOptions,
  LocationData,
  ScenePosition,
  GeolocationOptions,
  PermissionState,
  GeolocationEvents,
  CoordinateConverter,
  YouAreHereControllerOptions,
  ConfidenceState,
} from '../types';
