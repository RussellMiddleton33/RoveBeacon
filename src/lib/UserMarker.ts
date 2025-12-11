import * as THREE from 'three';
import { MercatorProjection } from '../utils/MercatorProjection';
import type { UserMarkerOptions, ScenePosition, ConfidenceState } from './types';

/**
 * Validates that a value is a finite number
 */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Normalizes an angle in degrees to [0, 360) range
 */
function normalizeAngleDegrees(degrees: number): number {
  let normalized = degrees % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

/**
 * Default pulse speed in radians per second (frame-rate independent)
 * Results in approximately 3.5 second pulse cycle
 */
const PULSE_SPEED_RADIANS_PER_SECOND = 1.8;

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
  accuracyRingColor: 0x4285F4,
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
};

/**
 * UserMarker - A Three.js component that displays a user's location
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
 * const marker = new UserMarker({ color: 0x4285F4 });
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
export class UserMarker extends THREE.Group {
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

  constructor(options: UserMarkerOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.createMarker();

    // Handle Coordinate System Orientation
    if (this.options.orientation === 'y-up') {
      // Rotate 90 degrees so the XY plane becomes the XZ plane
      this.rotation.x = -Math.PI / 2;
    }

    this.visible = false; // Hidden until first position update
  }

  private createMarker(): void {
    const { color, borderColor, dotSize, borderWidth, accuracyRingColor } = this.options;

    // Accuracy/Glow Ring (pulsing, shows GPS accuracy)
    const glowGeometry = new THREE.RingGeometry(dotSize + borderWidth + 2, dotSize + borderWidth + 20, 64);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: accuracyRingColor,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    this.glowMesh.position.z = 0.05;
    this.glowMesh.visible = this.options.showAccuracyRing;
    this.add(this.glowMesh);

    // White border/outline
    const borderGeometry = new THREE.CircleGeometry(dotSize + borderWidth, 32);
    const borderMaterial = new THREE.MeshBasicMaterial({
      color: borderColor,
      side: THREE.DoubleSide
    });
    this.borderMesh = new THREE.Mesh(borderGeometry, borderMaterial);
    this.borderMesh.position.z = 0.1;
    this.add(this.borderMesh);

    // Blue dot (main marker)
    const dotGeometry = new THREE.CircleGeometry(dotSize, 32);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide
    });
    this.dotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
    this.dotMesh.position.z = 0.2;
    this.add(this.dotMesh);

    // Direction cone (flashlight effect)
    this.coneGroup = this.createDirectionCone();
    this.coneGroup.visible = false;
    this.add(this.coneGroup);
  }

  private createDirectionCone(): THREE.Group {
    const { color, coneLength, coneWidth, coneOpacity } = this.options;
    const group = new THREE.Group();

    // Create merged geometry for all cone layers (reduces draw calls from 9 to 2)
    const layers = 8;
    const positions: number[] = [];
    const colors: number[] = [];

    // Convert hex color to RGB components
    const colorObj = new THREE.Color(color);
    const coreColor = new THREE.Color(0x82b1ff);

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
    return group;
  }

  /**
   * Get the projection instance used for coordinate conversion
   */
  getProjection(): MercatorProjection | null {
    return this.projection;
  }

  /**
   * Set the marker position in scene coordinates
   */
  setPosition(x: number, y: number, z: number = 0): void {
    // Validate inputs - reject NaN or Infinity
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      console.warn('UserMarker.setPosition: Invalid coordinates ignored');
      return;
    }

    // Track last position update time for staleness detection
    this.lastPositionUpdateTime = Date.now();

    // Reuse targetPosition to avoid allocation
    this.targetPosition.set(x, y, z + 2); // Slight elevation

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
  }

  /**
   * Set position from ScenePosition object
   */
  setPositionFromScene(pos: ScenePosition): void {
    this.setPosition(pos.x, pos.y, pos.z ?? 0);
  }

  /**
   * Set GPS accuracy in meters - affects the size of the accuracy ring
   * @param meters Accuracy in meters (will be clamped to reasonable bounds)
   */
  setAccuracy(meters: number): void {
    // Validate input
    if (!isValidNumber(meters)) {
      console.warn(`UserMarker.setAccuracy: Invalid accuracy value: ${meters}`);
      return;
    }

    // Clamp to reasonable bounds (0 to MAX_ACCURACY_METERS)
    this.currentAccuracy = Math.max(0, Math.min(MAX_ACCURACY_METERS, meters));
  }

  /**
   * Set heading from device orientation (compass)
   * This is used when GPS heading is not available or user is stationary
   * Automatically smooths noisy compass readings for a stable experience
   * @param heading Compass heading in degrees (0-360)
   */
  setDeviceHeading(heading: number | null): void {
    if (!isValidNumber(heading)) {
      this.deviceHeading = null;
      return;
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
  }

  /**
   * Reset device heading smoothing (useful when re-acquiring compass lock)
   */
  resetDeviceHeading(): void {
    this.deviceHeading = null;
  }

  /**
   * Set heading and speed - shows direction cone when moving fast enough
   * @param heading Degrees from north (0-360), clockwise. Values outside this range are normalized.
   * @param speed Speed in m/s
   */
  setHeading(heading: number | null, speed: number | null): void {
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
    const dt = isValidNumber(deltaTime) && deltaTime > 0 ? deltaTime : 0.016;

    // Auto-confidence: Check for staleness and accuracy degradation
    if (this.options.enableAutoConfidence && !this.manualConfidenceOverride && this.lastPositionUpdateTime > 0) {
      this.updateAutoConfidence();
    }

    // Smooth position interpolation
    if (this.options.smoothPosition && this.positionAlpha < 1) {
      // Frame-rate independent smoothing: faster dt = larger step
      const smoothingStep = this.options.positionSmoothingFactor * (dt / 0.016);
      this.positionAlpha = Math.min(1, this.positionAlpha + smoothingStep);
      this.position.lerpVectors(
        this.lastPosition,
        this.targetPosition,
        this.easeOutCubic(this.positionAlpha)
      );
    }

    // Smooth heading interpolation (frame-rate independent)
    if (this.currentHeading !== null && this.options.smoothHeading) {
      let diff = this.targetHeadingRadians - this.currentHeadingRadians;

      // Handle wrap-around for shortest path
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      // Frame-rate independent smoothing
      const headingStep = this.options.headingSmoothingFactor * (dt / 0.016);
      this.currentHeadingRadians += diff * headingStep;

      // Normalize to [-PI, PI] to prevent accumulation errors
      while (this.currentHeadingRadians > Math.PI) this.currentHeadingRadians -= Math.PI * 2;
      while (this.currentHeadingRadians < -Math.PI) this.currentHeadingRadians += Math.PI * 2;

      this.coneGroup.rotation.z = this.currentHeadingRadians;
    }

    // Accuracy ring pulse animation (frame-rate independent)
    if (this.glowMesh.visible) {
      // Frame-rate independent pulse: increment based on time, not frames
      this.pulsePhase += PULSE_SPEED_RADIANS_PER_SECOND * dt;

      // Prevent phase from growing unbounded (wrap at 2*PI)
      if (this.pulsePhase > Math.PI * 2) {
        this.pulsePhase -= Math.PI * 2;
      }

      const clampedAccuracy = Math.max(5, Math.min(100, this.currentAccuracy));
      const accuracyScale = clampedAccuracy / 20;
      const pulseAmount = 1 + Math.sin(this.pulsePhase) * 0.15;
      const finalScale = accuracyScale * pulseAmount;

      this.glowMesh.scale.set(finalScale, finalScale, 1);

      // Get material reference once to avoid repeated casting
      const glowMaterial = this.glowMesh.material as THREE.MeshBasicMaterial;
      const baseOpacity = Math.max(0.1, 0.4 - (clampedAccuracy / 300));
      glowMaterial.opacity = baseOpacity + Math.sin(this.pulsePhase) * 0.1;
    }

    // Scale marker based on camera distance (keeps consistent screen size)
    // Only update if distance changed significantly to avoid unnecessary work
    if (camera && cameraTarget) {
      const dist = camera.position.distanceTo(cameraTarget);

      // Only update scale if distance changed by more than 1%
      if (Math.abs(dist - this.lastCameraDistance) / (this.lastCameraDistance || 1) > 0.01) {
        this.lastCameraDistance = dist;
        this.lastScale = Math.max(0.1, dist / 1000);
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
    const confidencePriority: Record<ConfidenceState, number> = { 'high': 0, 'low': 1, 'lost': 2 };
    const newConfidence = confidencePriority[stalenessConfidence] >= confidencePriority[accuracyConfidence]
      ? stalenessConfidence
      : accuracyConfidence;

    // Only update if changed (avoids redundant material updates)
    if (newConfidence !== this.confidenceState) {
      this.applyConfidenceState(newConfidence);
    }
  }

  /**
   * Show/hide the accuracy ring
   */
  setAccuracyRingVisible(visible: boolean): void {
    this.glowMesh.visible = visible;
  }

  /**
   * Show/hide the direction cone (still requires movement to show)
   */
  setDirectionConeEnabled(enabled: boolean): void {
    this.options.showDirectionCone = enabled;
    if (!enabled) {
      this.coneGroup.visible = false;
    }
  }

  /**
   * Set the projection center for coordinate conversion
   * Call this once when your map initializes to enable setLatLng()
   * @param center [longitude, latitude] of the map/venue center
   * @param scale Scale factor for the projection (default: 1)
   * @throws Error if center is invalid
   */
  setProjectionCenter(center: [number, number], scale: number = 1): void {
    // MercatorProjection constructor validates inputs and throws on error
    this.projection = new MercatorProjection(center, scale);
  }

  /**
   * Set position directly from lat/lng coordinates
   * Automatically converts to scene coordinates using internal projection
   * Requires setProjectionCenter() to be called first
   * @param longitude Longitude in degrees
   * @param latitude Latitude in degrees
   * @param altitude Altitude in meters (optional, default: 0)
   */
  setLatLng(longitude: number, latitude: number, altitude: number = 0): void {
    if (!this.projection) {
      console.warn('UserMarker: Call setProjectionCenter() before setLatLng()');
      return;
    }

    // Validate inputs
    if (!isValidNumber(longitude) || !isValidNumber(latitude)) {
      console.warn(`UserMarker.setLatLng: Invalid coordinates (${longitude}, ${latitude})`);
      return;
    }

    const [x, y, z] = this.projection.lngLatToScene(longitude, latitude, altitude);
    this.setPosition(x, y, z);
  }

  /**
   * Update marker color
   * @param color Hex color value (e.g., 0x4285F4)
   */
  setColor(color: number): void {
    if (!isValidNumber(color)) return;
    (this.dotMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.options.color = color;
  }

  /**
   * Update dot color only
   */
  setDotColor(color: number): void {
    if (!isValidNumber(color)) return;
    (this.dotMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /**
   * Update border color
   */
  setBorderColor(color: number): void {
    if (!isValidNumber(color)) return;
    (this.borderMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /**
   * Update accuracy ring color
   */
  setRingColor(color: number): void {
    if (!isValidNumber(color)) return;
    (this.glowMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /**
   * Set the confidence/signal quality state manually
   * Affects visual appearance to indicate GPS reliability
   *
   * Note: Calling this method disables automatic confidence updates.
   * Call resetAutoConfidence() to re-enable automatic updates.
   *
   * @param state 'high' = good signal, 'low' = degraded, 'lost' = no signal
   */
  setConfidence(state: ConfidenceState): void {
    // Manual confidence call disables auto-confidence
    this.manualConfidenceOverride = true;
    this.applyConfidenceState(state);
  }

  /**
   * Re-enable automatic confidence updates based on staleness and accuracy
   * Call this after using setConfidence() manually to restore automatic behavior
   */
  resetAutoConfidence(): void {
    this.manualConfidenceOverride = false;
  }

  /**
   * Check if automatic confidence is currently enabled
   */
  isAutoConfidenceEnabled(): boolean {
    return this.options.enableAutoConfidence && !this.manualConfidenceOverride;
  }

  /**
   * Apply confidence state to visual elements (shared by manual and auto)
   */
  private applyConfidenceState(state: ConfidenceState): void {
    if (this.confidenceState === state) return;
    this.confidenceState = state;

    const dotMaterial = this.dotMesh.material as THREE.MeshBasicMaterial;
    const glowMaterial = this.glowMesh.material as THREE.MeshBasicMaterial;

    switch (state) {
      case 'high':
        // Normal appearance - use configured color
        dotMaterial.transparent = false;
        dotMaterial.opacity = 1;
        dotMaterial.color.setHex(this.options.color);
        dotMaterial.needsUpdate = true;
        glowMaterial.color.setHex(this.options.accuracyRingColor);
        this.coneGroup.visible = this.options.showDirectionCone && this.currentHeading !== null;
        break;
      case 'low':
        // Degraded - slightly faded with orange warning ring
        dotMaterial.transparent = true;
        dotMaterial.opacity = 0.7;
        dotMaterial.color.setHex(this.options.color);
        dotMaterial.needsUpdate = true;
        glowMaterial.color.setHex(0xffa500); // Orange tint for warning
        this.coneGroup.visible = false; // Hide cone when signal is degraded
        break;
      case 'lost':
        // Lost signal - grayed out
        dotMaterial.transparent = true;
        dotMaterial.opacity = 0.5;
        dotMaterial.color.setHex(0x888888); // Gray
        dotMaterial.needsUpdate = true;
        glowMaterial.color.setHex(0x888888); // Gray
        this.coneGroup.visible = false; // Hide cone when signal is lost
        break;
    }
  }

  /**
   * Get current confidence state
   */
  getConfidence(): ConfidenceState {
    return this.confidenceState;
  }

  /**
   * Hide the marker
   */
  hide(): void {
    this.visible = false;
  }

  /**
   * Show the marker (only works if position has been set)
   */
  show(): void {
    if (this.isVisible) {
      this.visible = true;
    }
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

        // Dispose material(s) - handle both single and array materials
        if (child.material) {
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

