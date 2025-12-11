# Performance Tuning Guide

This guide covers optimization strategies for mobile devices and performance-constrained environments.

## Quick Reference

| Scenario | Settings |
|----------|----------|
| High-end device | Default settings |
| Mobile (balanced) | `pulseSpeed: 0.15`, `headingSmoothingFactor: 0.08` |
| Mobile (battery saver) | `showAccuracyRing: false`, `smoothPosition: false` |
| Background mode | SDK auto-pauses when tab hidden |

---

## Frame Rate Optimization

### Reduce Visual Complexity

```typescript
// Minimal mode for best performance
const controller = new ThreeYouAreHereController({
  center: [-74.006, 40.7128],
  markerOptions: {
    showAccuracyRing: false,    // Remove pulsing ring
    showDirectionCone: false,   // Remove heading cone
    pulseSpeed: 0,              // Disable animations
    smoothPosition: false,      // Snap to position
    smoothHeading: false,       // Snap heading
  },
});
```

### Reduce Geometry Complexity

The SDK uses these geometry settings by default:

| Component | Segments | Draw Calls |
|-----------|----------|------------|
| Dot | 32 | 1 |
| Border | 32 | 1 |
| Ring | 64 | 1 |
| Cone | 8 layers | 2 |

---

## Battery Optimization

### GPS Update Rate

High-frequency GPS drains battery. The SDK throttles to 100ms minimum, but you can reduce further:

```typescript
geolocationOptions: {
  enableHighAccuracy: false,  // Use network location (faster, less precise)
  maximumAge: 5000,           // Accept 5-second-old positions
  timeout: 15000,             // Longer timeout = fewer retries
}
```

### Visibility Handling

The SDK automatically pauses GPS when the tab is hidden:

```typescript
// This happens automatically:
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    geolocation.pause();    // Stop GPS
  } else {
    geolocation.resume();   // Restart GPS
  }
});
```

### Manual Pause/Resume

For additional control (e.g., app goes to background):

```typescript
// Stop temporarily
controller.geolocation.stop();

// Resume later
await controller.geolocation.start();
```

---

## Memory Management

### Always Dispose

Memory leaks occur when controllers aren't properly disposed:

```typescript
// React example
useEffect(() => {
  const controller = new ThreeYouAreHereController({ center });
  controller.start(scene);

  return () => {
    controller.dispose(); // Critical!
  };
}, []);
```

### Avoid Listener Leaks

The SDK warns if you add too many listeners:

```
[RoveBeacon] Possible memory leak detected. 11 "update" listeners added.
```

Always store and call the unsubscribe function:

```typescript
// Good
const unsubscribe = geo.on('update', handler);
// Later...
unsubscribe();

// Also good
geo.off('update', handler);

// Clear all at once
geo.removeAllListeners();
```

---

## Mobile-Specific Tips

### iOS Compass Permission

iOS 13+ requires a user gesture for compass access:

```typescript
// Must be in a click/tap handler
button.addEventListener('click', async () => {
  await controller.requestPermissions();
  await controller.start(scene);
});
```

### Android GPS Warm-Up

First GPS fix can take 10-30 seconds. Show a loading indicator:

```typescript
let hasFirstFix = false;

controller.geolocation.on('update', () => {
  if (!hasFirstFix) {
    hasFirstFix = true;
    hideLoadingSpinner();
  }
});
```

### Reduce Compass Jitter

Mobile compasses are noisy. Increase smoothing:

```typescript
markerOptions: {
  headingSmoothingFactor: 0.05, // More smoothing (default: 0.15)
}
```

Trade-off: Lower values = smoother but slower response.

---

## Benchmarking

### Frame Time Measurement

```typescript
let frameCount = 0;
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  frameCount++;
  const now = performance.now();

  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }

  renderer.render(scene, camera);
}
```

### Target Metrics

| Metric | Target | Acceptable |
|--------|--------|------------|
| Frame time | <16ms | <33ms |
| FPS | 60 | 30 |
| Memory | Stable | <10MB growth/hour |
| GPS battery | N/A | Device-specific |

---

## Troubleshooting Performance

### Symptom: Stuttering animation

**Cause:** Heavy operations blocking main thread

**Fix:**
1. Reduce `pulseSpeed` or disable pulse
2. Disable `smoothPosition` / `smoothHeading`
3. Check for expensive operations in your `onUpdate` callback

### Symptom: High battery drain

**Cause:** GPS polling too frequently

**Fix:**
1. Set `enableHighAccuracy: false`
2. Increase `maximumAge` to accept cached positions
3. Ensure `dispose()` is called when component unmounts

### Symptom: Memory grows over time

**Cause:** Listener leaks or undisposed instances

**Fix:**
1. Check that `dispose()` is called
2. Store and call unsubscribe functions
3. Use `removeAllListeners()` on cleanup

---

## Future Improvements

The following are planned for v3.0:

- `qualityPreset: 'auto' | 'low' | 'medium' | 'high'`
- Battery API integration for automatic power saving
- Frame budget monitoring with callbacks
- Shared animation manager for multiple markers
