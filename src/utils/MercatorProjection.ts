/**
 * Web Mercator projection utilities
 * EPSG:3857 projection for Three.js compatibility
 */

export class MercatorProjection {
  private centerLng: number
  private centerLat: number
  private centerX: number  // Mercator X of center
  private centerY: number  // Mercator Y of center
  private scale: number
  private metersPerUnit: number
  
  constructor(center: [number, number], scale: number = 1) {
    this.centerLng = center[0]
    this.centerLat = center[1]
    
    // Calculate Mercator coordinates of center point
    this.centerX = this.lngToMercatorX(this.centerLng)
    this.centerY = this.latToMercatorY(this.centerLat)
    
    // Calculate meters per unit at this latitude
    this.metersPerUnit = this.getMercatorScale(this.centerLat)
    this.scale = scale
  }
  
  /**
   * Convert longitude to Mercator X
   * Range: [0, 1] where 0 = -180°, 0.5 = 0°, 1 = 180°
   */
  private lngToMercatorX(lng: number): number {
    return (lng + 180) / 360
  }
  
  /**
   * Convert latitude to Mercator Y
   * Uses the Web Mercator projection formula
   * Range: [0, 1] where 0 = 85.05°N, 0.5 = 0°, 1 = 85.05°S
   */
  private latToMercatorY(lat: number): number {
    // Clamp latitude to valid Mercator range
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
    const y = Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
    return (1 - y / Math.PI) / 2
  }
  
  /**
   * Get Mercator scale factor at given latitude
   */
  private getMercatorScale(lat: number): number {
    return 1 / Math.cos(lat * Math.PI / 180)
  }
  
  /**
   * Convert WGS84 coordinates to Three.js scene coordinates
   * Matches MapLibre's Web Mercator projection
   *
   * @param lng Longitude in degrees
   * @param lat Latitude in degrees
   * @param altitude Altitude in meters (optional)
   * @returns [x, y, z] coordinates in Three.js scene units
   */
  lngLatToScene(lng: number, lat: number, altitude: number = 0): [number, number, number] {
    // Convert to Mercator coordinates
    const mercX = this.lngToMercatorX(lng)
    const mercY = this.latToMercatorY(lat)
    
    // Calculate offset from center in Mercator units
    const deltaX = mercX - this.centerX
    const deltaY = mercY - this.centerY
    
    // Convert to scene units (matching MapLibre's scale)
    // The 512 factor comes from MapLibre's tile coordinate system
    const MERCATOR_COORDINATE_SCALE = 512 * this.scale
    const x = deltaX * MERCATOR_COORDINATE_SCALE
    // In MapLibre, Y increases downward (south), but in Three.js Z-up, Y increases north
    // So we need to negate Y to match the coordinate system (if we assume Z-up and Y-North)
    // However, standard 3D might be Y-up. 
    // The reference code used Z-up (x, y, z). 
    // "rotation={[-Math.PI / 2, 0, 0]} // Rotate 90 degrees around X to lie flat in Z-up system" in reference suggests Z-up.
    // Let's stick to the reference logic: x, -y, z.
    
    const y = -deltaY * MERCATOR_COORDINATE_SCALE
    const z = altitude * this.metersPerUnit * this.scale
    
    return [x, y, z]
  }
  
  /**
   * Convert Three.js scene coordinates back to WGS84
   */
  sceneToLngLat(x: number, y: number): [number, number] {
    const MERCATOR_COORDINATE_SCALE = 512 * this.scale
    
    // Convert from scene units to Mercator offset
    const deltaX = x / MERCATOR_COORDINATE_SCALE
    // Negate Y because we negated it in lngLatToScene
    const deltaY = -y / MERCATOR_COORDINATE_SCALE
    
    // Add to center Mercator coordinates
    const mercX = this.centerX + deltaX
    const mercY = this.centerY + deltaY
    
    // Convert back to lng/lat
    const lng = mercX * 360 - 180
    
    // Inverse Mercator Y to latitude conversion
    const y2 = (1 - mercY * 2) * Math.PI
    const lat = Math.atan(Math.sinh(y2)) * 180 / Math.PI
    
    return [lng, lat]
  }
  
  setCenter(center: [number, number]) {
    this.centerLng = center[0]
    this.centerLat = center[1]
    this.centerX = this.lngToMercatorX(this.centerLng)
    this.centerY = this.latToMercatorY(this.centerLat)
    this.metersPerUnit = this.getMercatorScale(this.centerLat)
  }
  
  setScale(scale: number) {
    this.scale = scale
  }
  
  getCenter(): [number, number] {
    return [this.centerLng, this.centerLat]
  }
  
  getScale(): number {
    return this.scale
  }
}

