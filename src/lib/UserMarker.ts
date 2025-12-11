import * as THREE from 'three';
import { MercatorProjection } from '../utils/MercatorProjection';
import type { UserMarkerOptions, ScenePosition } from './types';

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
};

/**
 * UserMarker - A Three.js component that displays a user's location
 * with accuracy ring and direction indicator.
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
 * // In animation loop
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
  private pulsePhase = 0;
  private currentAccuracy = 10;
  private isVisible = false;
  private projection: MercatorProjection | null = null;

  constructor(options: UserMarkerOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.createMarker();
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
    const layers = 8;
    
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const layerLength = coneLength * (1 - t * 0.3);
      const layerWidth = coneWidth * (1 - t * 0.5);
      
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(-layerWidth / 2, layerLength);
      shape.lineTo(layerWidth / 2, layerLength);
      shape.lineTo(0, 0);
      
      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: coneOpacity * (1 - t * 0.7),
        depthWrite: false,
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = 0.1 + t * 0.01;
      group.add(mesh);
    }
    
    // Bright core
    const coreShape = new THREE.Shape();
    coreShape.moveTo(0, 0);
    coreShape.lineTo(-4, coneLength * 0.7);
    coreShape.lineTo(4, coneLength * 0.7);
    coreShape.lineTo(0, 0);
    
    const coreGeometry = new THREE.ShapeGeometry(coreShape);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x82b1ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.position.z = 0.15;
    group.add(coreMesh);
    
    group.position.z = 0.05;
    return group;
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
    
    const newPos = new THREE.Vector3(x, y, z + 2); // Slight elevation
    
    if (!this.isVisible) {
      // First position - snap immediately
      this.position.copy(newPos);
      this.targetPosition.copy(newPos);
      this.lastPosition.copy(newPos);
      this.visible = true;
      this.isVisible = true;
    } else if (this.options.smoothPosition) {
      // Smooth interpolation
      this.lastPosition.copy(this.position);
      this.targetPosition.copy(newPos);
      this.positionAlpha = 0;
    } else {
      this.position.copy(newPos);
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
   */
  setAccuracy(meters: number): void {
    // Validate and clamp accuracy to reasonable bounds
    if (!Number.isFinite(meters) || meters < 0) {
      return;
    }
    this.currentAccuracy = Math.min(meters, 10000); // Cap at 10km
  }
  
  /**
   * Set heading and speed - shows direction cone when moving fast enough
   * @param heading Degrees from north (0-360), clockwise
   * @param speed Speed in m/s
   */
  setHeading(heading: number | null, speed: number | null): void {
    const isMoving = (speed ?? 0) > this.options.minSpeedForDirection;
    
    if (isMoving && heading !== null && !isNaN(heading)) {
      this.currentHeading = heading;
      this.coneGroup.visible = this.options.showDirectionCone;
    } else {
      this.currentHeading = null;
      this.coneGroup.visible = false;
    }
  }
  
  /**
   * Update animation - call this in your render loop
   * @param deltaTime Time since last frame (optional, for future use)
   * @param camera Camera for distance-based scaling (optional)
   * @param cameraTarget Target point camera is looking at (for distance calc)
   */
  update(deltaTime?: number, camera?: THREE.Camera, cameraTarget?: THREE.Vector3): void {
    // Smooth position interpolation
    if (this.options.smoothPosition && this.positionAlpha < 1) {
      this.positionAlpha = Math.min(1, this.positionAlpha + this.options.positionSmoothingFactor);
      this.position.lerpVectors(
        this.lastPosition, 
        this.targetPosition, 
        this.easeOutCubic(this.positionAlpha)
      );
    }
    
    // Smooth heading interpolation
    if (this.currentHeading !== null && this.options.smoothHeading) {
      const targetRot = -THREE.MathUtils.degToRad(this.currentHeading);
      let currentRot = this.coneGroup.rotation.z;
      let diff = targetRot - currentRot;
      
      // Handle wrap-around
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      this.coneGroup.rotation.z += diff * this.options.headingSmoothingFactor;
    }
    
    // Accuracy ring pulse animation
    if (this.glowMesh.visible) {
      this.pulsePhase += 0.03;
      
      const clampedAccuracy = Math.max(5, Math.min(100, this.currentAccuracy));
      const accuracyScale = clampedAccuracy / 10;
      const pulseAmount = 1 + Math.sin(this.pulsePhase) * 0.15;
      const finalScale = accuracyScale * pulseAmount;
      
      this.glowMesh.scale.set(finalScale, finalScale, 1);
      
      const baseOpacity = Math.max(0.1, 0.4 - (clampedAccuracy / 300));
      (this.glowMesh.material as THREE.MeshBasicMaterial).opacity = 
        baseOpacity + Math.sin(this.pulsePhase) * 0.1;
    }
    
    // Scale marker based on camera distance (keeps consistent screen size)
    if (camera && cameraTarget) {
      const dist = camera.position.distanceTo(cameraTarget);
      const scale = Math.max(0.1, dist / 1000);
      this.scale.set(scale, scale, 1);
    }
  }
  
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
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
   */
  setProjectionCenter(center: [number, number], scale: number = 1): void {
    this.projection = new MercatorProjection(center, scale);
  }

  /**
   * Update marker color
   */
  setColor(color: number): void {
    (this.dotMesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.options.color = color;
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}

