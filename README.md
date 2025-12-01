# 📍 RoveBeacon

A Three.js SDK for displaying user location with GPS accuracy ring and direction indicator. Perfect for mapping applications, AR experiences, and location-based games.

<p align="center">
  <a href="https://russellmiddleton33.github.io/RoveBeacon/">
    <img src="https://img.shields.io/badge/🚀_Live_Demo-Try_it_Now!-4285F4?style=for-the-badge&logoColor=white" alt="Live Demo" />
  </a>
</p>

<p align="center">
  <a href="https://russellmiddleton33.github.io/RoveBeacon/">
    <strong>👉 Try the Live Demo on your Phone! 👈</strong>
  </a>
</p>

> **Note:** The demo requires location permissions and works best on mobile devices with GPS.

---

## ✨ Features

- 🔵 **Blue dot marker** - Clean, Google Maps-style user location indicator
- 📍 **Accuracy ring** - Pulsing ring that scales with GPS accuracy
- 🧭 **Direction cone** - Shows heading when user is moving (like Apple Maps)
- 🎯 **Smooth animations** - Position and heading interpolation
- 📱 **Mobile-ready** - Handles geolocation permissions gracefully
- 🎨 **Customizable** - Colors, sizes, and behaviors are all configurable
- 📦 **Lightweight** - Only peer dependency is Three.js

## 📦 Installation

```bash
npm install rovebeacon three
```

## 🚀 Quick Start

```typescript
import * as THREE from 'three';
import { UserMarker, GeolocationProvider } from 'rovebeacon';

// Create your Three.js scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();

// Create the user marker and add to scene
const marker = new UserMarker({
  color: 0x4285F4,           // Google blue
  showAccuracyRing: true,
  showDirectionCone: true,
  minSpeedForDirection: 0.5, // m/s - only show direction when walking
});
scene.add(marker);

// Setup geolocation
const geo = new GeolocationProvider({
  enableHighAccuracy: true,
});

geo.on('update', (location) => {
  // Convert lat/lng to your scene coordinates
  const scenePos = convertToSceneCoords(location.longitude, location.latitude);
  
  marker.setPosition(scenePos.x, scenePos.y);
  marker.setAccuracy(location.accuracy);
  marker.setHeading(location.heading, location.speed);
});

geo.on('error', (error) => {
  console.error('Location error:', error.message);
});

geo.on('permissionChange', (state) => {
  if (state === 'denied') {
    // Show UI to ask user to enable location
  }
});

// Start tracking
geo.start();

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  
  // Update marker animations (accuracy pulse, smooth movement)
  marker.update(undefined, camera, controls.target);
  
  renderer.render(scene, camera);
}
animate();
```

## 📖 API Reference

### UserMarker

A Three.js `Group` that displays the user's location.

#### Constructor Options

```typescript
interface UserMarkerOptions {
  color?: number;                    // Main dot color (default: 0x4285F4)
  borderColor?: number;              // Border color (default: 0xffffff)
  dotSize?: number;                  // Dot radius (default: 9)
  borderWidth?: number;              // Border width (default: 3)
  showAccuracyRing?: boolean;        // Show accuracy ring (default: true)
  showDirectionCone?: boolean;       // Show direction cone (default: true)
  minSpeedForDirection?: number;     // Min speed to show direction (default: 0.5 m/s)
  coneLength?: number;               // Direction cone length (default: 45)
  coneWidth?: number;                // Direction cone width (default: 70)
  coneOpacity?: number;              // Direction cone opacity (default: 0.2)
  smoothPosition?: boolean;          // Enable smooth position (default: true)
  smoothHeading?: boolean;           // Enable smooth heading (default: true)
  positionSmoothingFactor?: number;  // Position lerp speed (default: 0.03)
  headingSmoothingFactor?: number;   // Heading lerp speed (default: 0.15)
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `setPosition(x, y, z?)` | Set marker position in scene coordinates |
| `setAccuracy(meters)` | Set GPS accuracy (affects ring size) |
| `setHeading(degrees, speed)` | Set heading and speed (shows cone when moving) |
| `update(dt?, camera?, target?)` | Update animations - call in render loop |
| `setColor(hex)` | Change marker color |
| `setAccuracyRingVisible(bool)` | Show/hide accuracy ring |
| `setDirectionConeEnabled(bool)` | Enable/disable direction cone |
| `dispose()` | Clean up resources |

### GeolocationProvider

Wraps the browser Geolocation API with events.

#### Constructor Options

```typescript
interface GeolocationOptions {
  enableHighAccuracy?: boolean;  // Use GPS (default: true)
  maximumAge?: number;           // Max cached position age in ms (default: 0)
  timeout?: number;              // Request timeout in ms (default: 10000)
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `start()` | Start watching location (returns Promise) |
| `stop()` | Stop watching location |
| `getCurrentPosition()` | Get single position (returns Promise) |
| `isAvailable()` | Check if geolocation is supported |
| `getPermissionState()` | Get current permission state |
| `isWatching()` | Check if currently tracking |
| `dispose()` | Clean up |

#### Events

```typescript
geo.on('update', (location: LocationData) => {
  // location.longitude, latitude, altitude, accuracy, speed, heading, timestamp
});

geo.on('error', (error: GeolocationPositionError | Error) => {
  // Handle error
});

geo.on('permissionChange', (state: PermissionState) => {
  // 'prompt' | 'granted' | 'denied' | 'unavailable' | 'requesting'
});
```

## 🗺️ Coordinate Conversion

The SDK doesn't include coordinate conversion - you need to convert lat/lng to your scene's coordinate system. Here's an example using Web Mercator:

```typescript
// Simple Mercator projection example
function lngLatToScene(lng: number, lat: number, center: [number, number]): { x: number, y: number } {
  const SCALE = 10000; // Adjust based on your scene scale
  
  const centerX = (center[0] + 180) / 360;
  const centerY = (1 - Math.log(Math.tan(center[1] * Math.PI / 180) + 
    1 / Math.cos(center[1] * Math.PI / 180)) / Math.PI) / 2;
  
  const x = (lng + 180) / 360;
  const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 
    1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2;
  
  return {
    x: (x - centerX) * SCALE,
    y: -(y - centerY) * SCALE, // Flip Y for Three.js
  };
}
```

## 🛠️ Development

### Run the Example App

```bash
git clone https://github.com/RussellMiddleton33/RoveBeacon.git
cd RoveBeacon
npm install
npm run dev
```

### Build the SDK

```bash
npm run build:lib
```

This outputs to `dist/`:
- `threejs-user-location.js` - ES Module
- `threejs-user-location.umd.cjs` - UMD bundle
- `*.d.ts` - TypeScript declarations

## 🌐 Browser Support

- Chrome 50+
- Firefox 55+
- Safari 10+
- Edge 79+
- Mobile Safari (iOS 10+)
- Chrome for Android

> **Note:** HTTPS is required for geolocation on most browsers.

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.
