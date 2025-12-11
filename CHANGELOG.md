# Changelog

All notable changes to the "rovemaps-you-are-here" project will be documented in this file.

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
