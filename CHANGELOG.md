# Changelog

All notable changes to the "rovemaps-you-are-here" project will be documented in this file.

## [2.1.0] - 2025-12-10

### Bug Fixes
- **removeAllListeners() Memory Leak**: Fixed missing cleanup of `deviceOrientation` listeners when clearing all events
- **setConfidence() Transparency**: Fixed transparency not working for 'low' and 'lost' states (missing `transparent: true` and `needsUpdate: true`)
- **Concurrent Start Timeout**: Added 5-second timeout to concurrent `start()` polling to prevent infinite loops
- **Duplicate Line**: Removed duplicate `group.position.z = 0.05` in direction cone creation

### New Features
- **Automatic Staleness Detection**: Marker confidence now automatically degrades based on time and accuracy
  - 30 seconds without update → 'low' confidence
  - 60 seconds without update → 'lost' confidence
  - Accuracy > 100m → 'low' confidence
  - Accuracy > 500m → 'lost' confidence
  - Fully configurable via `UserMarkerOptions`
  - `resetAutoConfidence()` to re-enable after manual override
  - `isAutoConfidenceEnabled()` to check current state

- **Device Orientation Smoothing**: Compass readings are now smoothed to reduce jitter
  - Uses same smoothing factor as GPS heading
  - New `resetDeviceHeading()` method to clear smoothing state

- **Mock Location Support**: Full testing/demo support for simulated locations
  - `setMockLocation(location)` - Set a single mock location
  - `startMockPath(locations, interval)` - Cycle through waypoints
  - `stopMockPath()` - Stop path simulation
  - `stopMocking()` - Exit mock mode entirely
  - `isMockMode()` - Check if mock mode is active
  - `clearLastLocation()` - Privacy helper to clear cached location

### Performance Improvements
- **Optimized Direction Cone**: Reduced draw calls from 9 to 2 using merged BufferGeometry with vertex colors
- **Fewer Material Objects**: Cone now uses 2 materials instead of 9

### New Options (UserMarkerOptions)
```typescript
enableAutoConfidence?: boolean;          // default: true
stalenessLowThresholdMs?: number;        // default: 30000 (30s)
stalenessLostThresholdMs?: number;       // default: 60000 (60s)
accuracyLowThresholdMeters?: number;     // default: 100
accuracyLostThresholdMeters?: number;    // default: 500
```

### CDN
- **unpkg**: `https://unpkg.com/rovemaps-you-are-here@2.1.0/dist/rovemaps-you-are-here.umd.cjs`
- **jsDelivr**: `https://cdn.jsdelivr.net/npm/rovemaps-you-are-here@2.1.0/dist/rovemaps-you-are-here.umd.cjs`

## [2.0.0] - 2025-12-10

### Breaking Changes
- **Input Validation**: Invalid coordinates now throw errors or return safe defaults instead of silently failing
- **MercatorProjection**: Constructor now validates all inputs and throws on invalid center/scale
- **YouAreHereController**: Constructor now validates center option and throws if invalid

### Critical Bug Fixes
- **Memory Leak - Animation Loop**: Fixed animation loop continuing after `stop()` in YouAreHereController
- **Race Condition - Concurrent start()**: Fixed race condition when calling `start()` multiple times concurrently
- **Heading Math**: Fixed heading normalization for GPS values > 360 or < 0 degrees
- **Altitude Scaling**: Fixed incorrect Mercator distortion applied to altitude values
- **Event Listener Leak**: Fixed potential memory leak when adding many event listeners
- **Disposed State**: All classes now track disposed state and prevent use after disposal

### Performance Improvements
- **Frame-Rate Independent Animations**: All animations now use deltaTime for consistent behavior across devices
- **Update Throttling**: GeolocationProvider now throttles updates to 100ms minimum interval
- **Camera Distance Caching**: UserMarker caches camera distance to reduce per-frame calculations
- **Set-based Event Listeners**: GeolocationProvider uses Set instead of Array for O(1) listener operations

### New Features
- **setConfidence()**: New method to indicate GPS signal quality ('high', 'low', 'lost')
- **getLastLocation()**: New method to retrieve the most recent location without subscribing
- **isSecureContext()**: New method to check if HTTPS is available (required for geolocation)
- **setDotColor/setBorderColor/setRingColor**: Individual color setters for marker components
- **hide()/show()**: Methods to toggle marker visibility
- **removeAllListeners()**: Method to clear all event listeners at once
- **listenerCount()**: Method to get current listener count per event

### Security
- **HTTPS Warning**: SDK now warns when running on non-HTTPS origins
- **Max Listener Warning**: Warns when > 10 listeners are added (potential memory leak)
- **Input Sanitization**: All public methods validate inputs before processing

### Documentation
- **Comprehensive JSDoc**: All public APIs now have detailed JSDoc with examples
- **Type Safety**: Improved TypeScript types with better documentation
- **CDN Examples**: Added static HTML examples for CDN usage

### CDN Support
- **UMD Build**: Available at `dist/rovemaps-you-are-here.umd.cjs`
- **Global**: Exposes `RoveMapsYouAreHere` global when loaded via script tag
- **unpkg**: `https://unpkg.com/rovemaps-you-are-here@2.0.0/dist/rovemaps-you-are-here.umd.cjs`
- **jsDelivr**: `https://cdn.jsdelivr.net/npm/rovemaps-you-are-here@2.0.0/dist/rovemaps-you-are-here.umd.cjs`

## [1.1.0] - 2025-12-10

### 🚀 Major Improvements
- **New Name**: The main controller is now called `YouAreHereController` (formerly `LocationMarkerController`). This is a breaking change for imports.
- **Orientation Support**: Added `orientation` option to `UserMarker`. Supports `'z-up'` (default) and `'y-up'` (standard Three.js).
- **Simpler Quick Start**: Documentation updated to prioritize `YouAreHereController` for easier setup.

### ⚡ Performance
- **Object Reuse**: `UserMarker` now reuses internal Vector3 objects, reducing garbage collection during high-frequency GPS updates.

### 🐛 Bug Fixes
- **Memory Leak**: Fixed a critical issue where calling `start()` multiple times on `GeolocationProvider` would create overlapping watchers.
- **Permission Cleanup**: Fixed potential listener leaks when permission status changes.

### 📦 Dependencies
- **Peer Dependency**: Moved `three` to `peerDependencies` to prevent "multiple instances of Three.js" errors.

## [1.0.0] - 2025-12-09
- Initial release.
