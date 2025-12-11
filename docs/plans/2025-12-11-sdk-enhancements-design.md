# RoveMaps SDK v3.0 Enhancement Plan

> Design document for mobile-first performance optimizations and DX improvements

## Overview

This document outlines the implementation plan for transforming RoveMaps YouAreHere SDK from a solid v2.x release into a best-in-class, mobile-optimized, enterprise-ready SDK.

### Goals

1. **Mobile Performance**: Adaptive quality, battery awareness, frame budget monitoring
2. **Testing Infrastructure**: Comprehensive unit, integration, and mobile device tests
3. **Observability**: Logging levels, error telemetry hooks, metrics callbacks
4. **Developer Experience**: CLI tooling, framework wrappers, interactive playground
5. **Documentation**: World-class README, architecture docs, performance tuning guide

---

## Phase 1: Core Performance Enhancements

### 1.1 Adaptive Quality System

**Files to create/modify:**
- `src/lib/quality/QualityManager.ts` (new)
- `src/lib/quality/QualityPresets.ts` (new)
- `src/lib/types.ts` (extend options)
- `src/lib/three/ThreeUserMarker.ts` (integrate)

**Design:**

```typescript
// src/lib/quality/QualityPresets.ts
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';

export interface QualitySettings {
  ringSegments: number;        // 16 | 32 | 64
  coneLayers: number;          // 3 | 5 | 8
  smoothPosition: boolean;
  smoothHeading: boolean;
  pulseEnabled: boolean;
  pulseSpeed: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, 'auto'>, QualitySettings> = {
  low: {
    ringSegments: 16,
    coneLayers: 3,
    smoothPosition: false,
    smoothHeading: false,
    pulseEnabled: true,
    pulseSpeed: 0.15,
  },
  medium: {
    ringSegments: 32,
    coneLayers: 5,
    smoothPosition: true,
    smoothHeading: true,
    pulseEnabled: true,
    pulseSpeed: 0.2,
  },
  high: {
    ringSegments: 64,
    coneLayers: 8,
    smoothPosition: true,
    smoothHeading: true,
    pulseEnabled: true,
    pulseSpeed: 0.3,
  },
};
```

```typescript
// src/lib/quality/QualityManager.ts
export class QualityManager {
  private currentPreset: QualityPreset = 'auto';
  private detectedPreset: Exclude<QualityPreset, 'auto'> = 'medium';

  constructor() {
    if (this.currentPreset === 'auto') {
      this.detectOptimalQuality();
    }
  }

  private detectOptimalQuality(): void {
    // Use hardware concurrency as primary signal
    const cores = navigator.hardwareConcurrency ?? 4;

    // Use device memory if available (Chrome only)
    const memory = (navigator as any).deviceMemory ?? 4;

    // Detect if mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (cores <= 2 || memory <= 2 || isMobile) {
      this.detectedPreset = 'low';
    } else if (cores <= 4 || memory <= 4) {
      this.detectedPreset = 'medium';
    } else {
      this.detectedPreset = 'high';
    }
  }

  getSettings(): QualitySettings {
    const preset = this.currentPreset === 'auto'
      ? this.detectedPreset
      : this.currentPreset;
    return QUALITY_PRESETS[preset];
  }

  setPreset(preset: QualityPreset): void {
    this.currentPreset = preset;
  }
}
```

**Integration points:**
- `ThreeUserMarker.createMarker()` uses `ringSegments` from QualityManager
- `ThreeUserMarker.createDirectionCone()` uses `coneLayers` from QualityManager
- Constructor accepts `qualityPreset` option

---

### 1.2 Frame Budget Monitor

**Files to create/modify:**
- `src/lib/performance/FrameMonitor.ts` (new)
- `src/lib/types.ts` (add callbacks)
- `src/lib/three/ThreeYouAreHereController.ts` (integrate)

**Design:**

```typescript
// src/lib/performance/FrameMonitor.ts
export interface FrameMonitorOptions {
  /** Target frame time in ms (default: 16.67 for 60fps) */
  targetFrameTime?: number;
  /** Number of frames to average (default: 30) */
  sampleSize?: number;
  /** Threshold multiplier to trigger warning (default: 1.5x target) */
  warningThreshold?: number;
  /** Callback when frame budget exceeded */
  onPerformanceWarning?: (avgFrameTime: number, droppedFrames: number) => void;
}

export class FrameMonitor {
  private frameTimes: number[] = [];
  private lastFrameTime = 0;
  private droppedFrames = 0;
  private options: Required<FrameMonitorOptions>;

  constructor(options: FrameMonitorOptions = {}) {
    this.options = {
      targetFrameTime: 16.67,
      sampleSize: 30,
      warningThreshold: 1.5,
      onPerformanceWarning: () => {},
      ...options,
    };
  }

  tick(timestamp: number): void {
    if (this.lastFrameTime > 0) {
      const frameTime = timestamp - this.lastFrameTime;
      this.frameTimes.push(frameTime);

      // Track dropped frames (>2x target)
      if (frameTime > this.options.targetFrameTime * 2) {
        this.droppedFrames++;
      }

      // Keep only recent samples
      if (this.frameTimes.length > this.options.sampleSize) {
        this.frameTimes.shift();
      }

      // Check threshold
      const avg = this.getAverageFrameTime();
      if (avg > this.options.targetFrameTime * this.options.warningThreshold) {
        this.options.onPerformanceWarning(avg, this.droppedFrames);
      }
    }
    this.lastFrameTime = timestamp;
  }

  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  getFPS(): number {
    const avg = this.getAverageFrameTime();
    return avg > 0 ? 1000 / avg : 0;
  }

  reset(): void {
    this.frameTimes = [];
    this.droppedFrames = 0;
  }
}
```

---

### 1.3 Battery-Aware Mode

**Files to create/modify:**
- `src/lib/performance/BatteryManager.ts` (new)
- `src/lib/types.ts` (add options)

**Design:**

```typescript
// src/lib/performance/BatteryManager.ts
export interface BatteryManagerOptions {
  /** Battery level to trigger low-power mode (default: 0.2 = 20%) */
  lowPowerThreshold?: number;
  /** Battery level to trigger critical mode (default: 0.1 = 10%) */
  criticalThreshold?: number;
  /** Callback when battery state changes */
  onBatteryStateChange?: (state: BatteryState) => void;
}

export type BatteryState = 'normal' | 'low' | 'critical' | 'charging' | 'unavailable';

export class BatteryManager {
  private battery: any = null; // BatteryManager API type
  private state: BatteryState = 'unavailable';
  private options: Required<BatteryManagerOptions>;
  private listeners: Set<(state: BatteryState) => void> = new Set();

  constructor(options: BatteryManagerOptions = {}) {
    this.options = {
      lowPowerThreshold: 0.2,
      criticalThreshold: 0.1,
      onBatteryStateChange: () => {},
      ...options,
    };
    this.init();
  }

  private async init(): Promise<void> {
    if (!('getBattery' in navigator)) {
      this.state = 'unavailable';
      return;
    }

    try {
      this.battery = await (navigator as any).getBattery();
      this.updateState();

      // Listen for changes
      this.battery.addEventListener('chargingchange', () => this.updateState());
      this.battery.addEventListener('levelchange', () => this.updateState());
    } catch {
      this.state = 'unavailable';
    }
  }

  private updateState(): void {
    if (!this.battery) return;

    const prevState = this.state;

    if (this.battery.charging) {
      this.state = 'charging';
    } else if (this.battery.level <= this.options.criticalThreshold) {
      this.state = 'critical';
    } else if (this.battery.level <= this.options.lowPowerThreshold) {
      this.state = 'low';
    } else {
      this.state = 'normal';
    }

    if (prevState !== this.state) {
      this.options.onBatteryStateChange(this.state);
      this.listeners.forEach(cb => cb(this.state));
    }
  }

  getState(): BatteryState {
    return this.state;
  }

  getLevel(): number | null {
    return this.battery?.level ?? null;
  }

  onStateChange(callback: (state: BatteryState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
```

---

### 1.4 GPS Update Rate Throttling

**Files to modify:**
- `src/lib/GeolocationProvider.ts`
- `src/lib/types.ts`

**Design:**

```typescript
// Add to GeolocationOptions interface
export interface GeolocationOptions {
  // ... existing options

  /**
   * Maximum GPS updates per second (default: 10)
   * Lower values reduce battery drain on high-frequency GPS devices
   */
  maxUpdateRate?: number;
}

// In GeolocationProvider, modify MIN_UPDATE_INTERVAL_MS calculation:
private get minUpdateInterval(): number {
  const maxRate = this.options.maxUpdateRate ?? 10;
  return Math.max(MIN_UPDATE_INTERVAL_MS, 1000 / maxRate);
}
```

---

### 1.5 Shared Animation Manager

**Files to create/modify:**
- `src/lib/animation/AnimationManager.ts` (new)
- `src/lib/three/ThreeYouAreHereController.ts` (integrate)

**Design:**

```typescript
// src/lib/animation/AnimationManager.ts
type AnimationCallback = (deltaTime: number) => void;

class AnimationManagerSingleton {
  private static instance: AnimationManagerSingleton;
  private callbacks: Set<AnimationCallback> = new Set();
  private animationId: number | null = null;
  private lastTime = 0;

  static getInstance(): AnimationManagerSingleton {
    if (!AnimationManagerSingleton.instance) {
      AnimationManagerSingleton.instance = new AnimationManagerSingleton();
    }
    return AnimationManagerSingleton.instance;
  }

  register(callback: AnimationCallback): () => void {
    this.callbacks.add(callback);

    // Start loop if first callback
    if (this.callbacks.size === 1) {
      this.start();
    }

    // Return unregister function
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0) {
        this.stop();
      }
    };
  }

  private start(): void {
    if (this.animationId !== null) return;

    this.lastTime = performance.now();
    const animate = (now: number) => {
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.callbacks.forEach(cb => {
        try {
          cb(dt);
        } catch (e) {
          console.error('[AnimationManager] Callback error:', e);
        }
      });

      this.animationId = requestAnimationFrame(animate);
    };

    this.animationId = requestAnimationFrame(animate);
  }

  private stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

export const AnimationManager = AnimationManagerSingleton.getInstance();
```

---

## Phase 2: Observability & Logging

### 2.1 Logging System

**Files to create/modify:**
- `src/lib/logging/Logger.ts` (new)
- `src/lib/types.ts` (extend SDKConfig)

**Design:**

```typescript
// src/lib/logging/Logger.ts
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  component: string;
  data?: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  onLog?: (entry: LogEntry) => void;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private onLog?: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'warn';
    this.prefix = options.prefix ?? 'RoveBeacon';
    this.onLog = options.onLog;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  private log(level: LogLevel, component: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      component,
      data,
    };

    // Custom handler
    this.onLog?.(entry);

    // Console output
    const formatted = `[${this.prefix}:${component}] ${message}`;
    switch (level) {
      case 'error': console.error(formatted, data ?? ''); break;
      case 'warn': console.warn(formatted, data ?? ''); break;
      case 'info': console.info(formatted, data ?? ''); break;
      case 'debug': console.log(formatted, data ?? ''); break;
    }
  }

  error(component: string, message: string, data?: unknown): void {
    this.log('error', component, message, data);
  }

  warn(component: string, message: string, data?: unknown): void {
    this.log('warn', component, message, data);
  }

  info(component: string, message: string, data?: unknown): void {
    this.log('info', component, message, data);
  }

  debug(component: string, message: string, data?: unknown): void {
    this.log('debug', component, message, data);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// Global logger instance
export const logger = new Logger();
```

### 2.2 Error Telemetry Hook

**Files to modify:**
- `src/lib/errors.ts`
- `src/lib/types.ts`

**Design:**

```typescript
// Add to SDKConfig
export interface SDKConfig {
  // ... existing

  /**
   * Callback for error telemetry (Sentry, Datadog, etc.)
   */
  onError?: (error: RoveError, context: ErrorContext) => void;
}

export interface ErrorContext {
  component: string;
  action: string;
  metadata?: Record<string, unknown>;
}

// Update RoveError to emit telemetry
export class RoveError extends Error {
  // ... existing

  static emit(
    code: RoveErrorCode,
    message: string,
    context: ErrorContext,
    originalError?: unknown
  ): RoveError {
    const error = new RoveError(code, message, originalError);
    const config = getSDKConfig();
    config.onError?.(error, context);
    return error;
  }
}
```

---

## Phase 3: Testing Infrastructure

### 3.1 Test Structure

```
tests/
├── unit/
│   ├── GeolocationProvider.test.ts
│   ├── ThreeUserMarker.test.ts
│   ├── MercatorProjection.test.ts
│   ├── QualityManager.test.ts
│   ├── FrameMonitor.test.ts
│   ├── BatteryManager.test.ts
│   └── AnimationManager.test.ts
├── integration/
│   ├── ThreeYouAreHereController.test.ts
│   ├── MapLibreYouAreHereController.test.ts
│   └── lifecycle.test.ts
├── e2e/
│   ├── mobile-simulation.spec.ts
│   ├── visibility-pause.spec.ts
│   └── compass-heading.spec.ts
└── fixtures/
    ├── mock-locations.ts
    └── mock-paths.ts
```

### 3.2 Key Test Cases to Add

**GeolocationProvider:**
- Permission denied flow
- Timeout handling
- GPS signal lost recovery
- Visibility pause/resume
- Mock mode lifecycle
- Concurrent start() calls
- Disposed state access

**ThreeUserMarker:**
- All confidence state transitions
- Invalid input handling (NaN, Infinity)
- Geometry disposal verification
- Frame-rate independence verification

**Integration:**
- Full controller lifecycle (start → update → stop → dispose)
- Error propagation from provider to controller
- Multiple markers with shared AnimationManager

---

## Phase 4: Developer Experience

### 4.1 CLI Tool

**Package:** `@rovemaps/cli` (separate npm package)

```bash
npx @rovemaps/create my-location-app
```

**Features:**
- Template selection (Three.js / MapLibre / React / Vue)
- TypeScript configuration
- Mock location data
- CI workflow template

### 4.2 Framework Wrappers

**Package:** `@rovemaps/react`

```tsx
import { useYouAreHere, YouAreHereMarker } from '@rovemaps/react';

function App() {
  const { location, error, isTracking } = useYouAreHere({
    center: [-74.006, 40.7128],
  });

  return (
    <Canvas>
      <YouAreHereMarker
        color={0x4285F4}
        showAccuracyRing
      />
    </Canvas>
  );
}
```

### 4.3 Interactive Playground

**Host:** StackBlitz / CodeSandbox template

**Features:**
- Live option editor with instant preview
- Mock path simulation
- Code export in multiple languages
- Performance metrics display

---

## Phase 5: Bundle & CI Improvements

### 5.1 Bundle Size Monitoring

**Add to package.json:**
```json
{
  "devDependencies": {
    "size-limit": "^11.0.0",
    "@size-limit/preset-small-lib": "^11.0.0"
  },
  "size-limit": [
    {
      "path": "dist/rovemaps-you-are-here.js",
      "limit": "20 KB"
    }
  ]
}
```

**Add to CI:**
```yaml
- name: Check bundle size
  run: npx size-limit
```

### 5.2 Coverage Requirements

**vitest.config.ts:**
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
```

---

## Implementation Order

### Sprint 1: Core Performance (Week 1-2)
1. QualityManager + presets
2. FrameMonitor
3. AnimationManager (shared loop)
4. GPS rate throttling
5. Unit tests for new modules

### Sprint 2: Observability (Week 2-3)
1. Logger system
2. Error telemetry hooks
3. Integrate logging throughout codebase
4. BatteryManager

### Sprint 3: Testing (Week 3-4)
1. Comprehensive unit tests
2. Integration tests
3. E2E tests with Playwright
4. Coverage thresholds

### Sprint 4: DX & Polish (Week 4-5)
1. Bundle size monitoring
2. CLI tool (basic)
3. Documentation overhaul
4. React wrapper (MVP)

---

## Migration Guide (v2.x → v3.0)

### Breaking Changes

1. **Constructor options**: New `qualityPreset` option defaults to `'auto'`
2. **Animation loop**: Controllers now use shared AnimationManager (no behavioral change)
3. **Logging**: `sdkWarn`/`sdkDebug` replaced with `logger.warn`/`logger.debug`

### New Features (Non-Breaking)

- `qualityPreset: 'auto' | 'low' | 'medium' | 'high'`
- `onPerformanceWarning` callback
- `onBatteryStateChange` callback
- `maxUpdateRate` option
- `logLevel` in SDKConfig

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Test coverage | ~20% | 80% |
| Bundle size | ~15KB | <20KB |
| Frame time (mobile) | Untested | <16ms p95 |
| Time to first fix | ~3s | <2s |
| Documentation score | Good | Excellent |
