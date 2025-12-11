import * as THREE from 'three';
import { getGlobalQualityManager } from '../performance/QualityManager';
import { MercatorProjection } from '../../utils/MercatorProjection';
import { isValidNumber, normalizeAngleDegrees } from '../../utils/validation';
import { sdkWarn } from '../types';
import type { UserMarkerOptions, ScenePosition, ConfidenceState } from '../types';

/**
 * Default pulse speed in cycles per second
 * @default 0.2 (approximately one pulse every 5 seconds)
 */
const DEFAULT_PULSE_SPEED = 0.2;

/**
 * Maximum iterations for angle normalization loops
 * Prevents infinite loops from invalid input
 */
const MAX_ANGLE_ITERATIONS = 10;

/**
 * Default accuracy ring size in meters
 */
const DEFAULT_ACCURACY_METERS = 10;

/**
 * Maximum accuracy value to prevent excessively large rings
 */
const MAX_ACCURACY_METERS = 10000;

/**
 * Time thresholds for automatic staleness detection (in milliseconds)
 */
const STALENESS_LOW_THRESHOLD_MS = 30000;  // 30 seconds -> 'low' confidence
const STALENESS_LOST_THRESHOLD_MS = 60000; // 60 seconds -> 'lost' confidence

/**
 * Accuracy thresholds for automatic confidence degradation (in meters)
 */
const ACCURACY_LOW_THRESHOLD_METERS = 100;  // >100m accuracy -> 'low' confidence
const ACCURACY_LOST_THRESHOLD_METERS = 500; // >500m accuracy -> 'lost' confidence

/**
 * Priority values for confidence states (higher number = worse confidence)
 */
const CONFIDENCE_PRIORITY: Record<ConfidenceState, number> = {
  'high': 0,
  'low': 1,
  'lost': 2,
  'warning': 3,
  'danger': 4
};

/**
 * Target delta time for frame-rate independent smoothing calculations (approx 60fps)
 */
const TARGET_DT_SEC = 0.016;

const DEFAULT_OPTIONS: Required<UserMarkerOptions> = {
  color: 0x4285F4,
  borderColor: 0xffffff,
  dotSize: 9,
  borderWidth: 3,
  showAccuracyRing: true,
  showDirectionCone: true,
  minSpeedForDirection: 0.5,
  coneLength: 45,
  coneWidth: 70,
  coneOpacity: 0.2,
  coneColor: 0x4285F4,
  accuracyRingColor: 0x4285F4,
  pulseSpeed: DEFAULT_PULSE_SPEED,
  smoothPosition: true,
  smoothHeading: true,
  positionSmoothingFactor: 0.03,
  headingSmoothingFactor: 0.15,
  orientation: 'z-up',
  enableAutoConfidence: true,
  stalenessLowThresholdMs: STALENESS_LOW_THRESHOLD_MS,
  stalenessLostThresholdMs: STALENESS_LOST_THRESHOLD_MS,
  accuracyLowThresholdMeters: ACCURACY_LOW_THRESHOLD_METERS,
  accuracyLostThresholdMeters: ACCURACY_LOST_THRESHOLD_METERS,
  minScale: 0.5,
  maxScale: 10,
  scaleReferenceDistance: 1000,
  scaleCurveExponent: 0.5,
  fixedScreenSize: true,
  overallScale: 1.0,
  ringScale: 0.7,
  mapLibreModule: null,
};

/**
 * Static cache for reuse across multiple marker instances
 */
const CACHE = {
  materials: new Map<string, THREE.MeshBasicMaterial>(),
  coneGeometries: new Map<string, THREE.Group>(),

  getMaterial(color: number, opacity: number = 1): THREE.MeshBasicMaterial {
    const key = `${color}-${opacity}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: false, // Prevent z-fighting with map
      });
      this.materials.set(key, material);
    }
    return material;
  }
};

/**
 * ThreeUserMarker - A Three.js component that displays a user's location
 * with accuracy ring and direction indicator.
 *
 * Features:
 * - Smooth position and heading interpolation
 * - Frame-rate independent animations
 * - Pulsing accuracy ring that reflects GPS precision
 * - Direction cone that shows heading when moving
 * - Support for both Y-up and Z-up coordinate systems
 *
 * @example
 * ```typescript
 * const marker = new ThreeUserMarker({ color: 0x4285F4 });
 * scene.add(marker);
 *
 * // Update position (in your scene coordinates)
 * marker.setPosition(x, y);
 * marker.setAccuracy(15); // meters
 * marker.setHeading(45, 1.5); // degrees, speed m/s
 *
 * // In animation loop (deltaTime in seconds)
 * marker.update(deltaTime, camera);
 * ```
 */
export class ThreeUserMarker extends THREE.Group {
  private options: Required<UserMarkerOptions>;

  // Meshes
  private dotMesh!: THREE.Mesh;
  private borderMesh!: THREE.Mesh;
  private glowMesh!: THREE.Mesh;
  private coneGroup!: THREE.Group;

  // Animation state
  private targetPosition = new THREE.Vector3();
  private lastPosition = new THREE.Vector3();
  private positionAlpha = 1;
  private currentHeading: number | null = null;
  private targetHeadingRadians = 0;
  private currentHeadingRadians = 0;
  private isFirstHeading = true;
  private pulsePhase = 0;
  private currentAccuracy = DEFAULT_ACCURACY_METERS;
  private isVisible = false;
  private projection: MercatorProjection | null = null;
  private isDisposed = false;
  // Track if we own the materials (created custom) or borrowed from cache
  private usingCachedMaterials = true;

  // Device orientation state
  private deviceHeading: number | null = null;
  private useCompasHeading = true;

  // Cached values to avoid per-frame allocations
  private lastCameraDistance = 0;
  private lastScale = 1;

  // Confidence state for GPS quality indication
  private confidenceState: ConfidenceState = 'high';
  private manualConfidenceOverride = false; // If true, auto-confidence is disabled
  private lastPositionUpdateTime = 0; // Timestamp of last position update for staleness detection
  private lostStateStartTime = 0; // When "lost" state began (for grow animation)
  private lostGrowDuration = 60000; // 60 seconds to reach max size
  private savedPulseSpeed = 0; // Store original pulse speed when entering warning/danger
  private savedConeColor = 0; // Store original cone color when entering warning/danger

  // Pre-created materials for each confidence state (avoids GPU recompiles)
  private dotMaterials!: Record<ConfidenceState, THREE.MeshBasicMaterial>;
  private glowMaterials!: Record<ConfidenceState, THREE.MeshBasicMaterial>;

  constructor(options: UserMarkerOptions = {}) {
    super();

    // Get quality settings and apply defaults if not overridden
    const qualityManager = getGlobalQualityManager();
    const qualitySettings = qualityManager.getSettings();

    // Merge defaults -> quality settings -> user options
    // Note: User options take precedence over quality settings
    const mergedOptions: UserMarkerOptions = {
      ...DEFAULT_OPTIONS,
      // Apply quality-dependent defaults
      pulseSpeed: options.pulseSpeed ?? (qualitySettings.pulseEnabled ? DEFAULT_PULSE_SPEED : 0),
      smoothPosition: options.smoothPosition ?? qualitySettings.smoothPosition,
      smoothHeading: options.smoothHeading ?? qualitySettings.smoothHeading,
      ...options
    };

    this.options = mergedOptions as Required<UserMarkerOptions>;
    this.createMarker();

    // Handle Coordinate System Orientation
    if (this.options.orientation === 'y-up') {
      // Rotate 90 degrees so the XY plane becomes the XZ plane
      this.rotation.x = -Math.PI / 2;
    }

    this.visible = false; // Hidden until first position update
  }

  private createMaterials(): void {
    // Instead of creating new materials for every marker, use the static cache
    // This allows batching and reduces GPU memory when many markers are used

    this.dotMaterials = {
      high: CACHE.getMaterial(this.options.color, 1.0),
      low: CACHE.getMaterial(this.options.color, 0.7),
      lost: CACHE.getMaterial(0x888888, 0.5),
      warning: CACHE.getMaterial(0xff9500, 1.0),
      danger: CACHE.getMaterial(0xff3b30, 1.0),
    };

    this.glowMaterials = {
      high: CACHE.getMaterial(this.options.accuracyRingColor, 0.2),
      low: CACHE.getMaterial(this.options.accuracyRingColor, 0.15),
      lost: CACHE.getMaterial(0x888888, 0.1),
      warning: CACHE.getMaterial(0xff9500, 0.3),
      danger: CACHE.getMaterial(0xff3b30, 0.3),
    };
  }

  /*
   * @deprecated Private method refactored to use createMaterials and build mesh in constructor or init
   * But wait, createMarker was called in constructor. We must restore the mesh creation logic
   * that was deleted/replaced incorrectly.
   */
  private createMarker(): void {
    this.createMaterials();

    const { dotSize, borderWidth, borderColor } = this.options;

    // Center Dot
    const dotGeometry = new THREE.CircleGeometry(dotSize, 32);
    this.dotMesh = new THREE.Mesh(dotGeometry, this.dotMaterials.high);
    // Lift slightly to avoid z-fighting
    this.dotMesh.position.z = 0.1;

    // White Border
    const borderGeometry = new THREE.CircleGeometry(dotSize + borderWidth, 32);
    // Fixed: cached material for border too
    const borderMaterial = CACHE.getMaterial(borderColor, 1.0);
    this.borderMesh = new THREE.Mesh(borderGeometry, borderMaterial);

    // Accuracy Ring (pulsing glow)
    const ringGeometry = new THREE.CircleGeometry(1, 64); // Unit radius, scale later
    this.glowMesh = new THREE.Mesh(ringGeometry, this.glowMaterials.high);
    this.glowMesh.visible = this.options.showAccuracyRing;

    // Direction Cone
    this.coneGroup = this.createDirectionCone();
    this.coneGroup.visible = false; // Hidden until moving

    this.add(this.glowMesh);
    this.add(this.borderMesh);
    this.add(this.dotMesh);
    this.add(this.coneGroup);
  }

  private createDirectionCone(): THREE.Group {
    const { coneColor, coneLength, coneWidth, coneOpacity } = this.options;

    // Check cache first
    const cacheKey = `${coneColor}-${coneLength}-${coneWidth}-${coneOpacity}`;
    const cachedGroup = CACHE.coneGeometries.get(cacheKey);

    if (cachedGroup) {
      // Clone the group structure but share geometry/materials where possible
      // Note: We need a clone because we modify rotation/position/visibility per instance
      // But we want to share the heavyweight geometry/materials
      // Actually, standard clone() shares geometry and material by reference, which is what we want!
      return cachedGroup.clone();
    }

    const group = new THREE.Group();

    // Create merged geometry for all cone layers (reduces draw calls from 9 to 2)
    const layers = 8;
    const positions: number[] = [];
    const colors: number[] = [];

    // Convert hex color to RGB components
    const colorObj = new THREE.Color(coneColor);
    // Create a lighter version of the cone color for the core highlight
    const coreColor = new THREE.Color(coneColor).lerp(new THREE.Color(0xffffff), 0.5);

    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const layerLength = coneLength * (1 - t * 0.3);
      const layerWidth = coneWidth * (1 - t * 0.5);
      const layerZ = 0.1 + t * 0.01;
      const layerOpacity = coneOpacity * (1 - t * 0.7);

      // Triangle vertices for this layer
      // Vertex 1: origin
      positions.push(0, 0, layerZ);
      // Vertex 2: left edge
      positions.push(-layerWidth / 2, layerLength, layerZ);
      // Vertex 3: right edge
      positions.push(layerWidth / 2, layerLength, layerZ);

      // Vertex colors with alpha encoded in RGB (we'll use material opacity for overall control)
      // Use darker colors for outer layers to simulate opacity gradient
      const blendedR = colorObj.r * layerOpacity + (1 - layerOpacity);
      const blendedG = colorObj.g * layerOpacity + (1 - layerOpacity);
      const blendedB = colorObj.b * layerOpacity + (1 - layerOpacity);

      for (let v = 0; v < 3; v++) {
        colors.push(blendedR, blendedG, blendedB);
      }
    }

    // Create BufferGeometry for cone layers
    const coneGeometry = new THREE.BufferGeometry();
    coneGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    coneGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const coneMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1, // Opacity is baked into vertex colors
      depthWrite: false,
    });

    const coneMesh = new THREE.Mesh(coneGeometry, coneMaterial);
    group.add(coneMesh);

    // Bright core (separate mesh for the highlight effect)
    const corePositions = [
      0, 0, 0.15,
      -4, coneLength * 0.7, 0.15,
      4, coneLength * 0.7, 0.15
    ];
    const coreColors = [
      coreColor.r, coreColor.g, coreColor.b,
      coreColor.r, coreColor.g, coreColor.b,
      coreColor.r, coreColor.g, coreColor.b
    ];

    const coreGeometry = new THREE.BufferGeometry();
    coreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corePositions, 3));
    coreGeometry.setAttribute('color', new THREE.Float32BufferAttribute(coreColors, 3));

    const coreMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(coreMesh);

    group.position.z = 0.05;

    // Cache the prototype group
    CACHE.coneGeometries.set(cacheKey, group);

    // Return a clone for this instance
    return group.clone();
  }

  /**
   * Get the projection instance used for coordinate conversion
   */
  getProjection(): MercatorProjection | null {
    return this.projection;
  }

  /**
   * Set the marker position in scene coordinates
   * @returns this for method chaining
   */
  setPosition(x: number, y: number, z: number = 0): this {
    // Validate inputs - reject NaN or Infinity
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      sdkWarn('ThreeUserMarker.setPosition: Invalid coordinates ignored');
      return this;
    }

    // Track last position update time for staleness detection
    this.lastPositionUpdateTime = Date.now();

    // Reuse targetPosition to avoid allocation
    // Small elevation (0.1) to prevent z-fighting with ground plane
    this.targetPosition.set(x, y, z + 0.1);

    if (!this.isVisible) {
      // First position - snap immediately
      this.position.copy(this.targetPosition);
      this.lastPosition.copy(this.targetPosition);
      this.visible = true;
      this.isVisible = true;
    } else if (this.options.smoothPosition) {
      // Smooth interpolation
      this.lastPosition.copy(this.position);
      // targetPosition is already set above
      this.positionAlpha = 0;
    } else {
      this.position.copy(this.targetPosition);
    }
    return this;
  }

  /**
   * Set position from ScenePosition object
   * @returns this for method chaining
   */
  setPositionFromScene(pos: ScenePosition): this {
    return this.setPosition(pos.x, pos.y, pos.z ?? 0);
  }

  /**
   * Set GPS accuracy in meters - affects the size of the accuracy ring
   * @param meters Accuracy in meters (will be clamped to reasonable bounds)
   * @returns this for method chaining
   */
  setAccuracy(meters: number): this {
    // Validate input
    if (!isValidNumber(meters)) {
      sdkWarn(`ThreeUserMarker.setAccuracy: Invalid accuracy value: ${meters}`);
      return this;
    }

    // Clamp to reasonable bounds (0 to MAX_ACCURACY_METERS)
    this.currentAccuracy = Math.max(0, Math.min(MAX_ACCURACY_METERS, meters));
    return this;
  }

  /**
   * Set heading from device orientation (compass)
   * This is used when GPS heading is not available or user is stationary
   * Automatically smooths noisy compass readings for a stable experience
   * @param heading Compass heading in degrees (0-360)
   * @returns this for method chaining
   */
  setDeviceHeading(heading: number | null): this {
    if (!isValidNumber(heading)) {
      this.deviceHeading = null;
      return this;
    }

    const normalizedHeading = normalizeAngleDegrees(heading);

    if (this.deviceHeading === null) {
      // First reading - set directly
      this.deviceHeading = normalizedHeading;
    } else {
      // Smooth noisy compass readings using the same smoothing as GPS heading
      // Calculate shortest angular difference
      let diff = normalizedHeading - this.deviceHeading;
      while (diff > 180) diff -= 360;
      while (diff < -180) diff += 360;

      // Apply smoothing factor (use heading smoothing factor for consistency)
      // Lower factor = more smoothing = less jitter
      const smoothingFactor = this.options.headingSmoothingFactor;
      this.deviceHeading = normalizeAngleDegrees(this.deviceHeading + diff * smoothingFactor);
    }
    return this;
  }

  /**
   * Reset device heading smoothing (useful when re-acquiring compass lock)
   * @returns this for method chaining
   */
  resetDeviceHeading(): this {
    this.deviceHeading = null;
    return this;
  }

  /**
   * Set heading and speed - shows direction cone when moving fast enough
   * @param heading Degrees from north (0-360), clockwise. Values outside this range are normalized.
   * @param speed Speed in m/s
   * @returns this for method chaining
   */
  setHeading(heading: number | null, speed: number | null): this {
    const isMoving = isValidNumber(speed) && speed > this.options.minSpeedForDirection;

    // Determine which heading to use
    let activeHeading: number | null = null;

    if (isMoving && isValidNumber(heading)) {
      // Prioritize GPS heading when moving
      activeHeading = normalizeAngleDegrees(heading);
    } else if (this.deviceHeading !== null) {
      // Fallback to compass when stationary
      activeHeading = this.deviceHeading;
    }

    if (activeHeading !== null) {
      // Update internal state
      this.currentHeading = activeHeading;

      // Convert to radians for rotation (negative because rotation is counter-clockwise)
      this.targetHeadingRadians = -THREE.MathUtils.degToRad(activeHeading);

      // On first heading, snap immediately instead of interpolating from 0
      if (this.isFirstHeading) {
        this.currentHeadingRadians = this.targetHeadingRadians;
        this.coneGroup.rotation.z = this.currentHeadingRadians;
        this.isFirstHeading = false;
      }

      this.coneGroup.visible = this.options.showDirectionCone;
    } else {
      // Keep showing last known heading if we have neither, or hide if we never had one?
      // Current behavior: hide if we are not moving and have no compass
      if (!isMoving && this.deviceHeading === null) {
        this.coneGroup.visible = false;
      } else {
        // If we have compass (handled above) or are just stopped but want to show last heading?
        // For now, let's keep it simple: if no active heading source, hide cone
        // But wait, the logic above handles `activeHeading !== null`.
        // So here means activeHeading IS null.
        this.currentHeading = null;
        this.coneGroup.visible = false;
      }
    }
    return this;
  }

  /**
   * Update animation - call this in your render loop
   * @param deltaTime Time since last frame in seconds (required for frame-rate independent animation)
   * @param camera Camera for distance-based scaling (optional)
   * @param cameraTarget Target point camera is looking at (for distance calc)
   */
  update(deltaTime?: number, camera?: THREE.Camera, cameraTarget?: THREE.Vector3): void {
    if (this.isDisposed) return;

    // Default to 16ms (~60fps) if deltaTime not provided for backwards compatibility
    const dt = isValidNumber(deltaTime) && deltaTime > 0 ? deltaTime : TARGET_DT_SEC;

    // Auto-confidence: Check for staleness and accuracy degradation
    if (this.options.enableAutoConfidence && !this.manualConfidenceOverride && this.lastPositionUpdateTime > 0) {
      this.updateAutoConfidence();
    }

    // Smooth position interpolation
    if (this.options.smoothPosition && this.positionAlpha < 1) {
      // Frame-rate independent smoothing: faster dt = larger step
      const smoothingStep = this.options.positionSmoothingFactor * (dt / TARGET_DT_SEC);
      this.positionAlpha = Math.min(1, this.positionAlpha + smoothingStep);
      this.position.lerpVectors(
        this.lastPosition,
        this.targetPosition,
        this.easeOutCubic(this.positionAlpha)
      );
    }

    // Smooth heading interpolation (frame-rate independent)
    if (this.currentHeading !== null && this.options.smoothHeading) {
      // Guard against NaN/Infinity to prevent infinite loops
      if (!Number.isFinite(this.currentHeadingRadians)) {
        this.currentHeadingRadians = 0;
      }
      if (!Number.isFinite(this.targetHeadingRadians)) {
        this.targetHeadingRadians = 0;
      }

      let diff = this.targetHeadingRadians - this.currentHeadingRadians;

      // Handle wrap-around for shortest path (with iteration limit for safety)
      let iterations = 0;
      while (diff > Math.PI && iterations < MAX_ANGLE_ITERATIONS) { diff -= Math.PI * 2; iterations++; }
      iterations = 0;
      while (diff < -Math.PI && iterations < MAX_ANGLE_ITERATIONS) { diff += Math.PI * 2; iterations++; }

      // Frame-rate independent smoothing
      const headingStep = this.options.headingSmoothingFactor * (dt / TARGET_DT_SEC);
      this.currentHeadingRadians += diff * headingStep;

      // Normalize to [-PI, PI] to prevent accumulation errors (with iteration limit)
      iterations = 0;
      while (this.currentHeadingRadians > Math.PI && iterations < MAX_ANGLE_ITERATIONS) { this.currentHeadingRadians -= Math.PI * 2; iterations++; }
      iterations = 0;
      while (this.currentHeadingRadians < -Math.PI && iterations < MAX_ANGLE_ITERATIONS) { this.currentHeadingRadians += Math.PI * 2; iterations++; }

      this.coneGroup.rotation.z = this.currentHeadingRadians;
    }

    // Accuracy ring animation
    if (this.glowMesh.visible) {
      const glowMaterial = this.glowMesh.material as THREE.MeshBasicMaterial;

      if (this.confidenceState === 'lost') {
        // LOST STATE: No pulsing, slowly grow the ring over 60 seconds
        const timeSinceLost = Date.now() - this.lostStateStartTime;
        const growProgress = Math.min(1, timeSinceLost / this.lostGrowDuration);

        // Start from current accuracy scale, grow to 3x over 60 seconds
        const clampedAccuracy = Math.max(5, Math.min(100, this.currentAccuracy));
        const baseScale = clampedAccuracy / 20;
        const maxGrowMultiplier = 3; // Grow up to 3x the base size
        const growScale = 1 + (maxGrowMultiplier - 1) * growProgress;

        const finalScale = baseScale * growScale * this.options.overallScale * this.options.ringScale;
        this.glowMesh.scale.set(finalScale, finalScale, 1);

        // Static low opacity, no animation
        glowMaterial.opacity = 0.12;

      } else if (this.options.pulseSpeed > 0) {
        // NORMAL PULSE ANIMATION (high/low confidence)
        // Frame-rate independent pulse: convert cycles/sec to radians/sec (multiply by 2π)
        const pulseRadiansPerSecond = this.options.pulseSpeed * Math.PI * 2;
        this.pulsePhase += pulseRadiansPerSecond * dt;

        // Prevent phase from growing unbounded (wrap at 2*PI)
        if (this.pulsePhase > Math.PI * 2) {
          this.pulsePhase -= Math.PI * 2;
        }

        const clampedAccuracy = Math.max(5, Math.min(100, this.currentAccuracy));
        const accuracyScale = clampedAccuracy / 20;
        const pulseAmount = 1 + Math.sin(this.pulsePhase) * 0.15;
        // Apply both overallScale and independent ringScale
        const finalScale = accuracyScale * pulseAmount * this.options.overallScale * this.options.ringScale;

        this.glowMesh.scale.set(finalScale, finalScale, 1);

        const baseOpacity = this.confidenceState === 'low' ? 0.18 : Math.max(0.1, 0.4 - (clampedAccuracy / 300));
        glowMaterial.opacity = baseOpacity + Math.sin(this.pulsePhase) * 0.1;
      } else {
        // No pulse animation - just static scale
        const clampedAccuracy = Math.max(5, Math.min(100, this.currentAccuracy));
        // Apply both overallScale and independent ringScale
        const accuracyScale = clampedAccuracy / 20 * this.options.overallScale * this.options.ringScale;
        this.glowMesh.scale.set(accuracyScale, accuracyScale, 1);
      }
    }

    // Scale marker based on camera distance
    if (camera && cameraTarget) {
      const dist = camera.position.distanceTo(cameraTarget);

      // Only update scale if distance changed by more than 1%
      if (Math.abs(dist - this.lastCameraDistance) / (this.lastCameraDistance || 1) > 0.01) {
        this.lastCameraDistance = dist;

        if (this.options.fixedScreenSize) {
          // Fixed screen size mode (like MapLibre):
          // Scale linearly with distance to maintain constant apparent size
          // Reference distance defines where scale = 1
          const { scaleReferenceDistance, overallScale } = this.options;
          this.lastScale = (dist / scaleReferenceDistance) * overallScale;
        } else {
          // Zoom-adaptive scaling algorithm:
          // 1. Normalize distance relative to reference distance
          // 2. Apply power curve for non-linear scaling (lower exponent = more gradual)
          // 3. Clamp to min/max bounds
          // 4. Apply overall scale multiplier
          const { minScale, maxScale, scaleReferenceDistance, scaleCurveExponent, overallScale } = this.options;
          const normalizedDist = dist / scaleReferenceDistance;
          const rawScale = Math.pow(normalizedDist, scaleCurveExponent) * overallScale;
          this.lastScale = Math.max(minScale, Math.min(maxScale, rawScale));
        }

        this.scale.set(this.lastScale, this.lastScale, 1);
      }
    }
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Automatically update confidence based on staleness and accuracy
   * Called every frame when enableAutoConfidence is true
   */
  private updateAutoConfidence(): void {
    const now = Date.now();
    const timeSinceUpdate = now - this.lastPositionUpdateTime;

    // Determine confidence based on staleness (time since last update)
    let stalenessConfidence: ConfidenceState = 'high';
    if (timeSinceUpdate >= this.options.stalenessLostThresholdMs) {
      stalenessConfidence = 'lost';
    } else if (timeSinceUpdate >= this.options.stalenessLowThresholdMs) {
      stalenessConfidence = 'low';
    }

    // Determine confidence based on accuracy
    let accuracyConfidence: ConfidenceState = 'high';
    if (this.currentAccuracy >= this.options.accuracyLostThresholdMeters) {
      accuracyConfidence = 'lost';
    } else if (this.currentAccuracy >= this.options.accuracyLowThresholdMeters) {
      accuracyConfidence = 'low';
    }

    // Use the worse of the two confidence levels
    const newConfidence = CONFIDENCE_PRIORITY[stalenessConfidence] >= CONFIDENCE_PRIORITY[accuracyConfidence]
      ? stalenessConfidence
      : accuracyConfidence;

    // Only update if changed (avoids redundant material updates)
    if (newConfidence !== this.confidenceState) {
      this.applyConfidenceState(newConfidence);
    }
  }

  /**
   * Show/hide the accuracy ring
   * @returns this for method chaining
   */
  setAccuracyRingVisible(visible: boolean): this {
    this.glowMesh.visible = visible;
    return this;
  }

  /**
   * Show/hide the direction cone (still requires movement to show)
   * @returns this for method chaining
   */
  setDirectionConeEnabled(enabled: boolean): this {
    this.options.showDirectionCone = enabled;
    if (!enabled) {
      this.coneGroup.visible = false;
    }
    return this;
  }

  /**
   * Set the projection center for coordinate conversion
   * Call this once when your map initializes to enable setLatLng()
   * @param center [longitude, latitude] of the map/venue center
   * @param scale Scale factor for the projection (default: 1)
   * @throws Error if center is invalid
   * @returns this for method chaining
   */
  setProjectionCenter(center: [number, number], scale: number = 1): this {
    // MercatorProjection constructor validates inputs and throws on error
    this.projection = new MercatorProjection(center, scale);
    return this;
  }

  /**
   * Set position directly from lat/lng coordinates
   * Automatically converts to scene coordinates using internal projection
   * Requires setProjectionCenter() to be called first
   * @param longitude Longitude in degrees
   * @param latitude Latitude in degrees
   * @param altitude Altitude in meters (optional, default: 0)
   * @returns this for method chaining
   */
  setLatLng(longitude: number, latitude: number, altitude: number = 0): this {
    if (!this.projection) {
      sdkWarn('ThreeUserMarker: Call setProjectionCenter() before setLatLng()');
      return this;
    }

    // Validate inputs
    if (!isValidNumber(longitude) || !isValidNumber(latitude)) {
      sdkWarn(`ThreeUserMarker.setLatLng: Invalid coordinates (${longitude}, ${latitude})`);
      return this;
    }

    const [x, y, z] = this.projection.lngLatToScene(longitude, latitude, altitude);
    return this.setPosition(x, y, z);
  }

  /**
   * Update marker color
   * @param color Hex color value (e.g., 0x4285F4)
   * @returns this for method chaining
   */
  setColor(color: number): this {
    if (!isValidNumber(color)) return this;
    this.options.color = color;
    // Update high and low confidence dot materials (lost stays grey)
    this.dotMaterials.high.color.setHex(color);
    this.dotMaterials.low.color.setHex(color);
    return this;
  }

  /**
   * Update dot color only
   * @returns this for method chaining
   */
  setDotColor(color: number): this {
    if (!isValidNumber(color)) return this;
    this.options.color = color;
    // Update high and low confidence dot materials (lost stays grey)
    this.dotMaterials.high.color.setHex(color);
    this.dotMaterials.low.color.setHex(color);
    return this;
  }

  /**
   * Update border color
   * @returns this for method chaining
   */
  setBorderColor(color: number): this {
    if (!isValidNumber(color)) return this;
    (this.borderMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    return this;
  }

  /**
   * Update accuracy ring color
   * @returns this for method chaining
   */
  setRingColor(color: number): this {
    if (!isValidNumber(color)) return this;
    this.options.accuracyRingColor = color;
    // Update high and low confidence glow materials (lost stays grey)
    this.glowMaterials.high.color.setHex(color);
    this.glowMaterials.low.color.setHex(color);
    return this;
  }

  /**
   * Update direction cone (heading indicator) color
   * Note: This recreates the cone geometry with the new color
   * @returns this for method chaining
   */
  setConeColor(color: number): this {
    if (!isValidNumber(color)) return this;
    this.options.coneColor = color;

    // Recreate the cone with new color
    this.remove(this.coneGroup);
    this.coneGroup = this.createDirectionCone();
    this.coneGroup.visible = this.options.showDirectionCone && this.currentHeading !== null;
    this.add(this.coneGroup);

    return this;
  }

  /**
   * Set the confidence/signal quality state manually
   * Affects visual appearance to indicate GPS reliability
   *
   * Note: Calling this method disables automatic confidence updates.
   * Call resetAutoConfidence() to re-enable automatic updates.
   *
   * @param state 'high' = good signal, 'low' = degraded, 'lost' = no signal
   * @returns this for method chaining
   */
  setConfidence(state: ConfidenceState): this {
    // Manual confidence call disables auto-confidence
    this.manualConfidenceOverride = true;
    this.applyConfidenceState(state);
    return this;
  }

  /**
   * Re-enable automatic confidence updates based on staleness and accuracy
   * Call this after using setConfidence() manually to restore automatic behavior
   * @returns this for method chaining
   */
  resetAutoConfidence(): this {
    this.manualConfidenceOverride = false;
    return this;
  }

  /**
   * Check if automatic confidence is currently enabled
   */
  isAutoConfidenceEnabled(): boolean {
    return this.options.enableAutoConfidence && !this.manualConfidenceOverride;
  }

  /**
   * Apply confidence state to visual elements (shared by manual and auto)
   * Uses pre-created materials to avoid GPU recompiles
   */
  private applyConfidenceState(state: ConfidenceState): void {
    const previousState = this.confidenceState;
    if (previousState === state) return;
    this.confidenceState = state;

    // Track when we enter "lost" state for the grow animation
    if (state === 'lost' && previousState !== 'lost') {
      this.lostStateStartTime = Date.now();
    }

    // Save original settings when entering warning/danger, restore when leaving
    const isEnteringAlert = (state === 'warning' || state === 'danger') &&
      (previousState !== 'warning' && previousState !== 'danger');
    const isLeavingAlert = (state !== 'warning' && state !== 'danger') &&
      (previousState === 'warning' || previousState === 'danger');

    if (isEnteringAlert) {
      // Save current settings
      this.savedPulseSpeed = this.options.pulseSpeed;
      this.savedConeColor = this.options.coneColor;
    }

    if (isLeavingAlert && this.savedPulseSpeed > 0) {
      // Restore original settings
      this.options.pulseSpeed = this.savedPulseSpeed;
      this.options.coneColor = this.savedConeColor;
      // Recreate cone with original color
      this.remove(this.coneGroup);
      this.coneGroup = this.createDirectionCone();
      this.add(this.coneGroup);
    }

    // Swap to pre-created materials (no GPU recompile needed)
    this.dotMesh.material = this.dotMaterials[state];
    this.glowMesh.material = this.glowMaterials[state];

    // Handle cone visibility and color based on state
    if (state === 'high') {
      this.coneGroup.visible = this.options.showDirectionCone && this.currentHeading !== null;
    } else if (state === 'warning') {
      // Warning: orange cone, faster pulse (0.35)
      this.options.pulseSpeed = 0.35;
      this.options.coneColor = 0xff9500;
      this.remove(this.coneGroup);
      this.coneGroup = this.createDirectionCone();
      this.add(this.coneGroup);
      this.coneGroup.visible = this.options.showDirectionCone && this.currentHeading !== null;
    } else if (state === 'danger') {
      // Danger: red cone, even faster pulse (0.55)
      this.options.pulseSpeed = 0.55;
      this.options.coneColor = 0xff3b30;
      this.remove(this.coneGroup);
      this.coneGroup = this.createDirectionCone();
      this.add(this.coneGroup);
      this.coneGroup.visible = this.options.showDirectionCone && this.currentHeading !== null;
    } else {
      // Hide cone for low/lost states
      this.coneGroup.visible = false;
    }
  }

  /**
   * Get current confidence state
   */
  getConfidence(): ConfidenceState {
    return this.confidenceState;
  }

  /**
   * Set the overall scale multiplier for the entire marker
   * @param scale Scale multiplier (1.0 = default size)
   * @returns this for method chaining
   */
  setOverallScale(scale: number): this {
    if (!isValidNumber(scale) || scale <= 0) {
      sdkWarn(`ThreeUserMarker.setOverallScale: Invalid scale value: ${scale}`);
      return this;
    }
    this.options.overallScale = scale;
    // Force scale update on next frame
    this.lastCameraDistance = 0;
    return this;
  }

  /**
   * Get the current overall scale
   */
  getOverallScale(): number {
    return this.options.overallScale;
  }

  /**
   * Set the pulse animation speed
   * @param speed Cycles per second (0 = no pulsing)
   * @returns this for method chaining
   */
  setPulseSpeed(speed: number): this {
    if (!isValidNumber(speed) || speed < 0) {
      sdkWarn(`ThreeUserMarker.setPulseSpeed: Invalid speed value: ${speed}`);
      return this;
    }
    this.options.pulseSpeed = speed;
    return this;
  }

  /**
   * Get the current pulse speed
   */
  getPulseSpeed(): number {
    return this.options.pulseSpeed;
  }

  /**
   * Set the independent ring/pulse scale multiplier
   * @param scale Scale multiplier (1.0 = default size)
   * @returns this for method chaining
   */
  setRingScale(scale: number): this {
    if (!isValidNumber(scale) || scale <= 0) {
      sdkWarn(`ThreeUserMarker.setRingScale: Invalid scale value: ${scale}`);
      return this;
    }
    this.options.ringScale = scale;
    return this;
  }

  /**
   * Get the current ring scale
   */
  getRingScale(): number {
    return this.options.ringScale;
  }

  /**
   * Set the dot stroke (border) width
   * Note: This recreates the border geometry for the new size
   * @param width Width in scene units
   * @returns this for method chaining
   */
  setDotStrokeWidth(width: number): this {
    if (!isValidNumber(width) || width < 0) {
      sdkWarn(`ThreeUserMarker.setDotStrokeWidth: Invalid width value: ${width}`);
      return this;
    }
    this.options.borderWidth = width;

    // Recreate border geometry with new size
    const newGeometry = new THREE.CircleGeometry(this.options.dotSize + width, 32);
    this.borderMesh.geometry.dispose();
    this.borderMesh.geometry = newGeometry;

    return this;
  }

  /**
   * Get the current dot stroke (border) width
   */
  getDotStrokeWidth(): number {
    return this.options.borderWidth;
  }

  /**
   * Hide the marker
   * @returns this for method chaining
   */
  hide(): this {
    this.visible = false;
    return this;
  }

  /**
   * Show the marker (only works if position has been set)
   * @returns this for method chaining
   */
  show(): this {
    if (this.isVisible) {
      this.visible = true;
    }
    return this;
  }

  /**
   * Clean up all Three.js resources (geometries, materials)
   * After calling dispose(), the marker should not be used
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Dispose geometry
        if (child.geometry) {
          child.geometry.dispose();
        }

        // Dispose material(s) ONLY if not using cached materials
        // Since we are using shared materials, we generally should NOT dispose them 
        // when a single marker is removed, as other markers might use them.
        // However, if we forced custom materials (not implemented in this refactor yet), we would.
        // For now, we skip material disposal for cached items.

        if (!this.usingCachedMaterials && child.material) {
          if (Array.isArray(child.material)) {
            for (const material of child.material) {
              material.dispose();
            }
          } else {
            child.material.dispose();
          }
        }
      }
    });

    // Clear references
    this.projection = null;
  }
}

