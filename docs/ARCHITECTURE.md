# Architecture Overview

This document describes the internal architecture of the RoveMaps YouAreHere SDK.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION LAYER                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Three.js / MapLibre App                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           CONTROLLER LAYER                               │
│                                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐  │
│  │ ThreeYouAreHere     │  │ MapLibreYouAreHere  │  │ MapBoxYouAreHere│  │
│  │ Controller          │  │ Controller          │  │ Controller      │  │
│  │                     │  │                     │  │                 │  │
│  │ - Lifecycle mgmt    │  │ - Lifecycle mgmt    │  │ - Lifecycle     │  │
│  │ - Animation loop    │  │ - Map integration   │  │ - Map integration│ │
│  │ - Event wiring      │  │ - Fly-to support    │  │ - Fly-to support│  │
│  └──────────┬──────────┘  └──────────┬──────────┘  └────────┬────────┘  │
│             │                        │                      │           │
└─────────────┼────────────────────────┼──────────────────────┼───────────┘
              │                        │                      │
              └────────────────────────┼──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            MARKER LAYER                                  │
│                                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐  │
│  │ ThreeUserMarker     │  │ MapLibreUserMarker  │  │ MapBoxUserMarker│  │
│  │                     │  │                     │  │                 │  │
│  │ - Three.js Group    │  │ - Canvas rendering  │  │ - Canvas render │  │
│  │ - Mesh creation     │  │ - MapLibre Marker   │  │ - MapBox Marker │  │
│  │ - Animation state   │  │ - Animation state   │  │ - Animation     │  │
│  │ - Confidence states │  │ - Confidence states │  │ - Confidence    │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PROVIDER LAYER                                  │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                      GeolocationProvider                             ││
│  │                                                                      ││
│  │  - Event emitter (update, error, permissionChange, deviceOrientation)│
│  │  - Browser Geolocation API wrapper                                   ││
│  │  - Permission state management                                       ││
│  │  - Update throttling (100ms minimum)                                 ││
│  │  - Visibility-based pause/resume                                     ││
│  │  - Mock location support                                             ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          UTILITY LAYER                                   │
│                                                                          │
│  ┌───────────────────┐  ┌───────────────────┐  ┌─────────────────────┐  │
│  │ MercatorProjection│  │    validation     │  │      errors         │  │
│  │                   │  │                   │  │                     │  │
│  │ - GPS to scene    │  │ - isValidNumber   │  │ - RoveError class   │  │
│  │ - Scene to GPS    │  │ - isValidLatitude │  │ - RoveErrorCode enum│  │
│  │ - Scale handling  │  │ - normalizeAngle  │  │                     │  │
│  └───────────────────┘  └───────────────────┘  └─────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### Controller Layer

**Purpose:** High-level orchestration of marker + geolocation

**Responsibilities:**
- Create and configure marker instance
- Create and configure GeolocationProvider (or accept injected LocationSource)
- Wire up events between provider and marker
- Manage lifecycle (start/stop/dispose)
- Handle coordinate conversion
- Manage animation loop (Three.js only)

**Key Pattern:** Composition over inheritance

```typescript
class ThreeYouAreHereController {
  public readonly marker: ThreeUserMarker;      // Has-a marker
  public readonly geolocation: LocationSource;  // Has-a provider
}
```

### Marker Layer

**Purpose:** Visual representation of user location

**Responsibilities:**
- Render marker geometry (dot, border, ring, cone)
- Handle animation (pulse, position smoothing, heading smoothing)
- Manage confidence states with pre-created materials
- Provide methods for customization (colors, visibility, scale)
- Clean up GPU resources on dispose

**Key Pattern:** Frame-rate independent animation

```typescript
update(deltaTime: number) {
  // All animations use deltaTime to be consistent across devices
  const step = smoothingFactor * (deltaTime / 0.016);
  this.positionAlpha += step;
}
```

### Provider Layer

**Purpose:** Abstract location data source

**Responsibilities:**
- Wrap browser Geolocation API
- Emit typed events (update, error, permissionChange, deviceOrientation)
- Handle permission flow
- Throttle updates to prevent performance issues
- Pause/resume based on page visibility
- Support mock locations for testing

**Key Pattern:** Event-based with typed listeners

```typescript
interface GeolocationEvents {
  update: LocationData;
  error: GeolocationPositionError | Error;
  permissionChange: PermissionState;
  deviceOrientation: DeviceOrientationEvent;
}
```

### Utility Layer

**Purpose:** Shared pure functions and classes

**Responsibilities:**
- Coordinate conversion (MercatorProjection)
- Input validation (isValidNumber, isValidLatitude)
- Error types (RoveError, RoveErrorCode)

**Key Pattern:** Pure functions with no side effects

```typescript
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
```

---

## Data Flow

### Location Update Flow

```
1. GPS API fires position callback
         │
         ▼
2. GeolocationProvider.handlePositionUpdate()
   - Throttle check (skip if <100ms since last)
   - Create LocationData object
   - Store in lastLocation
   - Emit 'update' event
         │
         ▼
3. Controller's event handler
   - Convert GPS → scene coordinates via MercatorProjection
   - Call marker.setPosition()
   - Call marker.setAccuracy()
   - Call marker.setHeading()
   - Call user's onUpdate callback
         │
         ▼
4. Marker updates target values
   - Store targetPosition (smooth mode)
   - Store targetHeading (smooth mode)
         │
         ▼
5. Animation loop calls marker.update(deltaTime)
   - Interpolate position toward target
   - Interpolate heading toward target
   - Update pulse animation
   - Check staleness for auto-confidence
```

### Confidence State Flow

```
1. Trigger source:
   A) Manual: marker.setConfidence('warning')
   B) Auto: staleness timer or accuracy threshold

         │
         ▼
2. applyConfidenceState(state)
   - Check if state changed
   - Swap pre-created materials (no GPU recompile)
   - Adjust pulse speed for warning/danger
   - Show/hide direction cone
   - Track lost state start time (for grow animation)

         │
         ▼
3. Visual update on next frame
   - Dot color matches state
   - Ring color matches state
   - Ring behavior changes:
     - high/low: normal pulse
     - lost: growing ring
     - warning/danger: fast pulse
```

---

## Coordinate Systems

### GPS (WGS84)

- Longitude: -180 to 180 (west to east)
- Latitude: -90 to 90 (south to north)
- Altitude: meters above ellipsoid

### Web Mercator (Internal)

- Used by MapLibre and conversion
- X: 0 to 1 (wraps at date line)
- Y: 0 to 1 (clamped at ~85.05° latitude)

### Three.js Scene (Z-Up)

- X: positive = east
- Y: positive = north
- Z: positive = up (altitude)
- Origin: configurable `center` point

### Three.js Scene (Y-Up)

- X: positive = east
- Y: positive = up (altitude)
- Z: positive = south (negated)
- Requires `orientation: 'y-up'` option

---

## Thread Safety

The SDK is designed for single-threaded browser environments but handles common concurrency scenarios:

### Concurrent start() Calls

```typescript
// Both calls return the same promise
const p1 = controller.start(scene);
const p2 = controller.start(scene);
await Promise.all([p1, p2]); // Works correctly
```

Implementation uses promise-based mutex:
```typescript
if (this.startPromise !== null) {
  return this.startPromise; // Return existing promise
}
this.startPromise = this.doStart();
```

### Disposed State

All classes track disposal and reject operations on disposed instances:

```typescript
if (this.isDisposed) {
  throw new Error('Cannot start disposed controller');
}
```

---

## Extension Points

### Custom LocationSource

Implement the `LocationSource` interface for custom providers:

```typescript
interface LocationSource {
  on(event: 'update', cb: (data: LocationData) => void): () => void;
  on(event: 'error', cb: (error: Error) => void): () => void;
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
}

// Example: WebSocket location source
class WebSocketLocationSource implements LocationSource {
  // ... implementation
}

// Usage
const controller = new ThreeYouAreHereController({
  center: [-74.006, 40.7128],
  locationSource: new WebSocketLocationSource(wsUrl),
});
```

### Custom Coordinate Converter

Implement `CoordinateConverter` for non-Mercator projections:

```typescript
interface CoordinateConverter {
  toScene(lng: number, lat: number, alt?: number): ScenePosition;
  fromScene?(x: number, y: number): { longitude: number; latitude: number };
}
```

---

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|-----------------|-------|
| Event listener add/remove | O(1) | Uses Set |
| Position update | O(1) | Direct assignment |
| Confidence state change | O(1) | Pre-created materials |
| Cone recreation | O(layers) | Only on color change |
| Animation update | O(1) | Fixed operations per frame |
| Dispose | O(meshes) | Traverses hierarchy |
