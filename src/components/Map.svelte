<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import * as THREE from 'three';
  import { MapControls } from 'three/addons/controls/MapControls.js';
  import { MercatorProjection } from '../utils/MercatorProjection';
  import DebugControls from './DebugControls.svelte';

  export let center: [number, number] = [-122.4194, 37.7749]; // Default SF
  export let zoom: number = 16; // Start zoom
  export let pitch: number = 45; // Default pitch

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: MapControls;
  let projection: MercatorProjection;

  // State
  let userPositionMesh: THREE.Group;
  let userGlowMesh: THREE.Mesh;
  let userDotMesh: THREE.Mesh;
  let userBorderMesh: THREE.Mesh;
  let userArrowMesh: THREE.Mesh;
  let lowConfCircleMesh: THREE.Mesh;
  let tileGroup: THREE.Group;
  let loadedTiles = new Set<string>();
  let currentLocation: [number, number] | null = null;
  let isFollowingUser = true;

  // Animation State
  let targetUserPos = new THREE.Vector3();
  let lastUserPos = new THREE.Vector3();
  let userPosAlpha = 1;
  let pulsePhase = 0;

  // Heading/Speed State
  let currentHeading: number | null = null;
  let compassHeading: number | null = null; // From device orientation (magnetometer)
  let gpsHeading: number | null = null; // From GPS movement
  let headingSource: 'compass' | 'gps' | 'none' = 'none';
  let currentSpeed: number = 0;
  let currentAltitude: number | null = null;
  let currentAccuracy: number = 0;

  // Confidence State
  type ConfidenceState = 'high' | 'low' | 'lost';
  let confidenceState: ConfidenceState = 'high';
  let isMarkerHidden = false;
  let lastGpsTime = Date.now();
  let currentOpacity = 1;
  let targetOpacity = 1;
  let lowConfidenceGrowth = 0;
  let signalLostFadeStart = 10; // seconds
  let signalLostFadeDuration = 20; // seconds
  let autoFadeOnSignalLoss = true;

  // Color settings
  let dotColor = '#4285F4';
  let borderColor = '#ffffff';
  let ringColor = '#4285F4';

  // UI Controls visibility
  let showControls = false;

  // Debug Info
  let info = {
    zoom: zoom,
    pitch: pitch,
    bearing: 0
  };

  // Location Info
  let locationInfo = {
    speed: 0,
    heading: null as number | null,
    altitude: null as number | null,
    accuracy: 0,
    updateCount: 0,
    lastUpdateTime: 0
  };

  // Permission state
  let locationPermission: 'prompt' | 'granted' | 'denied' | 'unavailable' | 'requesting' = 'prompt';
  let locationError: string | null = null;

  // Debug params
  let debugParams = {
    fov: 60,
    near: 10,
    far: 1000000,
    scale: 1
  };

  const dispatch = createEventDispatcher();

  // Constants
  const SCENE_SCALE = 78271.48; 
  
  function updateCameraParams(event: CustomEvent) {
    if (!camera) return;
    
    const params = event.detail;
    debugParams = params;
    
    camera.fov = params.fov;
    camera.near = params.near;
    camera.far = params.far;
    camera.updateProjectionMatrix();
  }

  function init() {
    console.log("Init started (MapControls)");
    try {
        // 1. Setup Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e); // Dark background for modern look
        
        // 4. Initialize Projection
        console.log("Initializing projection with center:", center);
        projection = new MercatorProjection(center, SCENE_SCALE);

        // 2. Setup Camera
        if (!container) {
            console.error("Container is missing in init");
            return;
        }
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // Camera setup for MapControls
        camera = new THREE.PerspectiveCamera(60, width / height, 10, 1000000);
        camera.up.set(0, 0, 1); // Z-up

        // 3. Setup Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
        
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // 5. Setup MapControls
        controls = new MapControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 100;
        controls.maxDistance = 500000;
        controls.maxPolarAngle = Math.PI / 2;

        const initialHeight = 600 * 2;
        
        camera.position.set(0, -initialHeight, initialHeight); 
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        
        controls.addEventListener('start', () => { isFollowingUser = false; });
        controls.addEventListener('change', () => {
            updateTilesBasedOnView();
            
            const height = camera.position.z;
            const z = Math.log2(40000000 / height);
            
            info = {
                zoom: z,
                pitch: controls.getPolarAngle() * 180 / Math.PI,
                bearing: controls.getAzimuthalAngle() * 180 / Math.PI
            };
        });

        // 6. Add Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight.position.set(1000, -1000, 1000);
        scene.add(dirLight);

        // 7. Grid Helper
        const gridSize = 20000;
        const gridDivisions = 200;
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x333355, 0x222244);
        gridHelper.rotation.x = Math.PI / 2;
        gridHelper.position.z = -0.1;
        scene.add(gridHelper);

        // 8. Tile Group
        tileGroup = new THREE.Group();
        scene.add(tileGroup);

        // 9. User Position Marker
        createUserMarker();

        // Start Animation Loop
        animate();

        // Initial Tiles
        setTimeout(() => {
            updateTilesBasedOnView();
        }, 100);
        
        // Start Geolocation - request permission
        requestLocationPermission();

        window.addEventListener('resize', onWindowResize);
    } catch (e) {
        console.error("Error in init:", e);
    }
  }

  function createUserMarker() {
    userPositionMesh = new THREE.Group();

    // Outer glow ring (pulsing) - for high confidence
    const glowGeometry = new THREE.RingGeometry(18, 25, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x4285F4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4
    });
    userGlowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    userGlowMesh.position.z = -0.2;
    userPositionMesh.add(userGlowMesh);

    // Low confidence solid circle (hidden by default)
    const lowConfGeometry = new THREE.CircleGeometry(25, 64);
    const lowConfMaterial = new THREE.MeshBasicMaterial({
      color: 0x4285F4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      depthWrite: false
    });
    lowConfCircleMesh = new THREE.Mesh(lowConfGeometry, lowConfMaterial);
    lowConfCircleMesh.position.z = -0.25;
    lowConfCircleMesh.visible = false;
    userPositionMesh.add(lowConfCircleMesh);

    // White border circle
    const borderGeometry = new THREE.CircleGeometry(12, 32);
    const borderMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1
    });
    userBorderMesh = new THREE.Mesh(borderGeometry, borderMaterial);
    userBorderMesh.position.z = 0.1;
    userPositionMesh.add(userBorderMesh);

    // Blue dot center
    const dotGeometry = new THREE.CircleGeometry(9, 32);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: 0x4285F4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1
    });
    userDotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
    userDotMesh.position.z = 0.2;
    userPositionMesh.add(userDotMesh);

    // Flashlight/Cone of vision indicator (like Apple Maps / Call of Duty radar)
    const coneGroup = new THREE.Group();

    // Create multiple layered triangles for gradient effect
    const coneLength = 45;
    const coneWidth = 70;
    const layers = 8;

    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const layerLength = coneLength * (1 - t * 0.3);
      const layerWidth = coneWidth * (1 - t * 0.5);

      const coneShape = new THREE.Shape();
      coneShape.moveTo(0, 0);
      coneShape.lineTo(-layerWidth / 2, layerLength);
      coneShape.lineTo(layerWidth / 2, layerLength);
      coneShape.lineTo(0, 0);

      const coneGeometry = new THREE.ShapeGeometry(coneShape);
      const coneMaterial = new THREE.MeshBasicMaterial({
        color: 0x4285F4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.2 * (1 - t * 0.7),
        depthWrite: false
      });

      const coneMesh = new THREE.Mesh(coneGeometry, coneMaterial);
      coneMesh.position.z = 0.1 + t * 0.01;
      coneGroup.add(coneMesh);
    }

    // Brighter core highlight
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
      depthWrite: false
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    coreMesh.position.z = 0.15;
    coneGroup.add(coreMesh);

    coneGroup.position.z = 0.05;
    userArrowMesh = coneGroup as unknown as THREE.Mesh;
    userArrowMesh.visible = false;
    userPositionMesh.add(userArrowMesh);

    userPositionMesh.visible = false;
    userPositionMesh.position.z = 2;
    scene.add(userPositionMesh);
  }

  // Confidence state management
  function setConfidence(state: ConfidenceState) {
    confidenceState = state;

    if (!userDotMesh || !userBorderMesh || !userGlowMesh || !lowConfCircleMesh) return;

    if (state === 'high') {
      userDotMesh.visible = true;
      userBorderMesh.visible = true;
      userGlowMesh.visible = true;
      lowConfCircleMesh.visible = false;
      (userDotMesh.material as THREE.MeshBasicMaterial).opacity = 1;
      (userBorderMesh.material as THREE.MeshBasicMaterial).opacity = 1;
      lowConfidenceGrowth = 0;
      targetOpacity = 1;
    } else if (state === 'low') {
      userDotMesh.visible = true;
      userBorderMesh.visible = true;
      (userDotMesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
      (userBorderMesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
      userGlowMesh.visible = false;
      lowConfCircleMesh.visible = true;
      if (userArrowMesh) userArrowMesh.visible = false;
      targetOpacity = 1;
    } else if (state === 'lost') {
      userDotMesh.visible = false;
      userBorderMesh.visible = false;
      userGlowMesh.visible = false;
      lowConfCircleMesh.visible = true;
      if (userArrowMesh) userArrowMesh.visible = false;
    }
  }

  function hideMarker() {
    isMarkerHidden = true;
    if (userPositionMesh) userPositionMesh.visible = false;
  }

  function showMarker() {
    isMarkerHidden = false;
    if (userPositionMesh && currentLocation) userPositionMesh.visible = true;
  }

  // Color update functions
  function updateDotColor(color: string) {
    if (userDotMesh) {
      (userDotMesh.material as THREE.MeshBasicMaterial).color.set(color);
    }
  }

  function updateBorderColor(color: string) {
    if (userBorderMesh) {
      (userBorderMesh.material as THREE.MeshBasicMaterial).color.set(color);
    }
  }

  function updateRingColor(color: string) {
    if (userGlowMesh) {
      (userGlowMesh.material as THREE.MeshBasicMaterial).color.set(color);
    }
    if (lowConfCircleMesh) {
      (lowConfCircleMesh.material as THREE.MeshBasicMaterial).color.set(color);
    }
    // Update cone colors
    if (userArrowMesh) {
      userArrowMesh.children.forEach((child, i) => {
        if (child instanceof THREE.Mesh && i < userArrowMesh.children.length - 1) {
          (child.material as THREE.MeshBasicMaterial).color.set(color);
        }
      });
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();

    if (isMarkerHidden) {
      renderer.render(scene, camera);
      return;
    }

    // Check for signal loss (auto-fade)
    const timeSinceGps = (Date.now() - lastGpsTime) / 1000;
    if (autoFadeOnSignalLoss && confidenceState !== 'lost' && locationPermission === 'granted' && timeSinceGps > signalLostFadeStart) {
      setConfidence('lost');
    }

    // Handle signal lost fade
    if (confidenceState === 'lost' && autoFadeOnSignalLoss) {
      if (timeSinceGps > signalLostFadeStart) {
        const fadeProgress = Math.min(1, (timeSinceGps - signalLostFadeStart) / signalLostFadeDuration);
        targetOpacity = 1 - fadeProgress;
      }
    }

    // Smooth opacity transition
    currentOpacity += (targetOpacity - currentOpacity) * 0.05;

    // Confidence-based ring/circle behavior
    if (userPositionMesh?.visible) {
      if (confidenceState === 'high' && userGlowMesh) {
        // Normal pulsing ring
        pulsePhase += 0.03;
        const clampedAccuracy = Math.max(5, Math.min(100, currentAccuracy || 10));
        const accuracyScale = clampedAccuracy / 10;
        const pulseAmount = 1 + Math.sin(pulsePhase) * 0.15;
        const finalScale = accuracyScale * pulseAmount;
        userGlowMesh.scale.set(finalScale, finalScale, 1);
        const baseOpacity = Math.max(0.1, 0.4 - (clampedAccuracy / 300));
        (userGlowMesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity + Math.sin(pulsePhase) * 0.1;

      } else if (confidenceState === 'low' && lowConfCircleMesh) {
        // Solid circle grows larger (uncertainty expanding), no pulsing
        lowConfidenceGrowth = Math.min(lowConfidenceGrowth + 0.01, 1);
        const growthScale = 1 + lowConfidenceGrowth * 2;
        const baseScale = Math.max(5, Math.min(100, currentAccuracy || 10)) / 10;
        lowConfCircleMesh.scale.set(baseScale * growthScale, baseScale * growthScale, 1);
        (lowConfCircleMesh.material as THREE.MeshBasicMaterial).opacity = (0.25 - lowConfidenceGrowth * 0.1) * currentOpacity;

      } else if (confidenceState === 'lost' && lowConfCircleMesh) {
        // Solid circle keeps growing very slowly and fades
        lowConfidenceGrowth = Math.min(lowConfidenceGrowth + 0.0008, 2);
        const growthScale = 1 + lowConfidenceGrowth * 1.5;
        const baseScale = Math.max(5, Math.min(100, currentAccuracy || 10)) / 10;
        lowConfCircleMesh.scale.set(baseScale * growthScale, baseScale * growthScale, 1);
        (lowConfCircleMesh.material as THREE.MeshBasicMaterial).opacity = 0.25 * currentOpacity;

        // Hide completely when faded out
        if (currentOpacity < 0.01) {
          userPositionMesh.visible = false;
        }
      }
    }

    // Smooth Position Interpolation
    if (userPositionMesh && userPosAlpha < 1) {
      userPosAlpha = Math.min(1, userPosAlpha + 0.03);
      userPositionMesh.position.lerpVectors(lastUserPos, targetUserPos, easeOutCubic(userPosAlpha));

      // If following, smoothly pan camera
      if (isFollowingUser && controls) {
        const targetWithZ = new THREE.Vector3(targetUserPos.x, targetUserPos.y, 0);
        controls.target.lerp(targetWithZ, 0.08);
      }
    }

    // Smooth Heading Interpolation (only in high confidence)
    if (userArrowMesh && currentHeading !== null && confidenceState === 'high') {
      const targetRot = -THREE.MathUtils.degToRad(currentHeading);
      let currentRot = userArrowMesh.rotation.z;
      let diff = targetRot - currentRot;

      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      userArrowMesh.rotation.z += diff * 0.15;
    }

    renderer.render(scene, camera);
  }
  
  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function onWindowResize() {
    if (!container || !camera || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  // --- Tile Logic ---

  function lngLatToTile(lng: number, lat: number, z: number) {
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }

  function tileToLngLatBounds(x: number, y: number, z: number) {
    const n = Math.pow(2, z);
    const lon1 = x / n * 360 - 180;
    const lon2 = (x + 1) / n * 360 - 180;
    const latRad1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const latRad2 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
    const lat1 = latRad1 * 180 / Math.PI;
    const lat2 = latRad2 * 180 / Math.PI;
    return {
      west: lon1,
      east: lon2,
      north: lat1,
      south: lat2
    };
  }

  let lastTileUpdate = 0;
  let lastLoadedZoom = -1;
  
  function updateTilesBasedOnView() {
    const now = Date.now();
    if (now - lastTileUpdate < 100) return; 
    lastTileUpdate = now;

    const centerPos = controls.target;
    const [lng, lat] = projection.sceneToLngLat(centerPos.x, centerPos.y);
    
    const height = camera.position.distanceTo(controls.target);
    const zoomLevel = Math.floor(Math.log2(40000000 / height));
    
    const loadZoom = Math.max(2, Math.min(19, zoomLevel));
    
    // Clear tiles if zoom level changed significantly
    if (lastLoadedZoom !== -1 && lastLoadedZoom !== loadZoom) {
        clearTiles();
    }
    lastLoadedZoom = loadZoom;
    
    const centerTile = lngLatToTile(lng, lat, loadZoom);
    const range = 2; 

    for (let x = centerTile.x - range; x <= centerTile.x + range; x++) {
      for (let y = centerTile.y - range; y <= centerTile.y + range; y++) {
        loadTile(x, y, loadZoom);
      }
    }
  }
  
  function clearTiles() {
    // Remove all tiles from the group and dispose resources
    while (tileGroup.children.length > 0) {
        const child = tileGroup.children[0];
        tileGroup.remove(child);
        
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.MeshBasicMaterial) {
                child.material.map?.dispose();
                child.material.dispose();
            }
        }
    }
    loadedTiles.clear();
  }

  function loadTile(x: number, y: number, z: number) {
    const key = `${z}/${x}/${y}`;
    if (loadedTiles.has(key)) return;
    loadedTiles.add(key);

    const bounds = tileToLngLatBounds(x, y, z);
    const nw = projection.lngLatToScene(bounds.west, bounds.north);
    const se = projection.lngLatToScene(bounds.east, bounds.south);
    
    const sceneX = (nw[0] + se[0]) / 2;
    const sceneY = (nw[1] + se[1]) / 2;
    const width = Math.abs(se[0] - nw[0]);
    const height = Math.abs(se[1] - nw[1]);

    const geometry = new THREE.PlaneGeometry(width, height);
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    
    loader.load(url, (texture) => {
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipMapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(sceneX, sceneY, 0);
      tileGroup.add(mesh);
    });
  }

  // --- Geolocation ---
  
  async function requestLocationPermission() {
    locationPermission = 'requesting';
    locationError = null;
    
    // Check if geolocation is available
    if (!('geolocation' in navigator)) {
      locationPermission = 'unavailable';
      locationError = 'Geolocation is not supported by your browser';
      return;
    }
    
    // Check permission status if available (not all browsers support this)
    if ('permissions' in navigator) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        console.log('Permission status:', result.state);
        
        result.onchange = () => {
          console.log('Permission changed to:', result.state);
          if (result.state === 'granted') {
            locationPermission = 'granted';
          } else if (result.state === 'denied') {
            locationPermission = 'denied';
            locationError = 'Location permission denied. Please enable in your browser settings.';
          }
        };
      } catch (e) {
        console.log('Permissions API not fully supported');
      }
    }
    
    // Actually request location - this triggers the browser prompt
    watchLocation();
  }

  function watchLocation() {
    if (!('geolocation' in navigator)) {
      locationPermission = 'unavailable';
      locationError = 'Geolocation not supported';
      return;
    }
    
    navigator.geolocation.watchPosition(
      (position) => {
        locationPermission = 'granted';
        locationError = null;

        // Reset confidence state on GPS update
        lastGpsTime = Date.now();
        if (confidenceState === 'lost') {
          setConfidence('high');
          currentOpacity = 1;
          targetOpacity = 1;
          lowConfidenceGrowth = 0;
          if (userPositionMesh) userPositionMesh.visible = true;
        }

        const { latitude, longitude, heading, speed, altitude, accuracy } = position.coords;
        currentLocation = [longitude, latitude];

        // Update location info for display
        locationInfo = {
          speed: speed ?? 0,
          heading: heading,
          altitude: altitude,
          accuracy: accuracy ?? 0,
          updateCount: locationInfo.updateCount + 1,
          lastUpdateTime: Date.now()
        };

        // Only show heading arrow when user is walking (speed > 0.5 m/s ~ 1.1 mph)
        const isWalking = (speed ?? 0) > 0.5;

        if (isWalking && heading !== null && !isNaN(heading) && confidenceState === 'high') {
          currentHeading = heading;
          if (userArrowMesh) {
            userArrowMesh.visible = true;
          }
        } else {
          if (userArrowMesh) {
            userArrowMesh.visible = false;
          }
          currentHeading = null;
        }

        currentSpeed = speed ?? 0;
        currentAltitude = altitude;
        currentAccuracy = accuracy ?? 0;

        updateUserMarker(longitude, latitude);
        
        dispatch('locationUpdate', { 
            longitude, 
            latitude, 
            heading,
            speed,
            altitude,
            accuracy,
            timestamp: position.timestamp 
        });
        
      }, 
      (error) => {
        console.error('Geolocation error:', error);
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            locationPermission = 'denied';
            locationError = 'Location access denied. Please enable location in your browser/device settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            locationPermission = 'unavailable';
            locationError = 'Location unavailable. Please check your GPS/network.';
            break;
          case error.TIMEOUT:
            locationError = 'Location request timed out. Retrying...';
            // Retry after timeout
            setTimeout(() => watchLocation(), 2000);
            break;
          default:
            locationError = 'Unknown location error';
        }
      }, 
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  }

  function updateUserMarker(lng: number, lat: number) {
    if (!userPositionMesh) return;
    
    const pos = projection.lngLatToScene(lng, lat);
    const newPos = new THREE.Vector3(pos[0], pos[1], 2);
    
    if (!userPositionMesh.visible) {
        // First update, snap immediately
        userPositionMesh.position.copy(newPos);
        targetUserPos.copy(newPos);
        lastUserPos.copy(newPos);
        userPositionMesh.visible = true;
        
        // Center camera on first location
        if (isFollowingUser && controls) {
            controls.target.set(pos[0], pos[1], 0);
        }
    } else {
        // Subsequent updates, start interpolation
        lastUserPos.copy(userPositionMesh.position);
        targetUserPos.copy(newPos);
        userPosAlpha = 0; // Reset interpolation
    }
    
    // Scale marker relative to camera height/distance
    const dist = camera.position.distanceTo(controls.target);
    const scale = Math.max(0.5, dist / 800);
    userPositionMesh.scale.set(scale, scale, 1);
  }

  onMount(() => {
    requestAnimationFrame(() => {
        if (container) {
            init();
        }
    });
  });

  onDestroy(() => {
    if (renderer) renderer.dispose();
    if (controls) controls.dispose();
  });
  
  // Format speed for display
  function formatSpeed(mps: number): string {
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  }
  
  function formatHeading(deg: number | null): string {
    if (deg === null) return '—';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return `${deg.toFixed(0)}° ${directions[index]}`;
  }
</script>

<div bind:this={container} class="map-container"></div>

<DebugControls 
  fov={debugParams.fov} 
  near={debugParams.near} 
  far={debugParams.far} 
  scale={debugParams.scale}
  on:update={updateCameraParams} 
/>

<!-- Camera Info -->
<div class="info-overlay camera-info">
  <div class="info-label">Camera</div>
  <div>Zoom: {info.zoom.toFixed(1)}</div>
  <div>Pitch: {info.pitch.toFixed(0)}°</div>
  <div>Bearing: {info.bearing.toFixed(0)}°</div>
</div>

<!-- Location Info -->
<div class="info-overlay location-info">
  <div class="info-label">Location</div>
  
  {#if locationPermission === 'prompt' || locationPermission === 'requesting'}
    <div class="permission-prompt">
      <div class="prompt-icon">📍</div>
      <div class="prompt-text">
        {locationPermission === 'requesting' ? 'Requesting location...' : 'Waiting for permission...'}
      </div>
      {#if locationPermission === 'prompt'}
        <button class="enable-location-btn" on:click={requestLocationPermission}>
          Enable Location
        </button>
      {/if}
    </div>
  {:else if locationPermission === 'denied' || locationPermission === 'unavailable'}
    <div class="permission-error">
      <div class="error-icon">⚠️</div>
      <div class="error-text">{locationError}</div>
      <button class="retry-btn" on:click={requestLocationPermission}>
        Try Again
      </button>
    </div>
  {:else}
    <div class="speed-display">
      <span class="speed-value">{formatSpeed(locationInfo.speed)}</span>
    </div>
    <div class="heading-display">
      <span class="heading-icon">🧭</span>
      <span>{formatHeading(locationInfo.heading)}</span>
    </div>
    
    <div class="data-grid">
      <div class="data-row">
        <span class="data-label">Lat</span>
        <span class="data-value">{currentLocation ? currentLocation[1].toFixed(6) : '—'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Lng</span>
        <span class="data-value">{currentLocation ? currentLocation[0].toFixed(6) : '—'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Alt</span>
        <span class="data-value">{locationInfo.altitude !== null ? `${locationInfo.altitude.toFixed(1)}m` : '—'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Speed</span>
        <span class="data-value">{locationInfo.speed ? `${locationInfo.speed.toFixed(2)} m/s` : '0'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Heading</span>
        <span class="data-value">{locationInfo.heading !== null ? `${locationInfo.heading.toFixed(1)}°` : '—'}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Accuracy</span>
        <span class="data-value">±{locationInfo.accuracy.toFixed(1)}m</span>
      </div>
      <div class="data-row">
        <span class="data-label">Updates</span>
        <span class="data-value">{locationInfo.updateCount}</span>
      </div>
      <div class="data-row">
        <span class="data-label">Last</span>
        <span class="data-value">{locationInfo.lastUpdateTime ? new Date(locationInfo.lastUpdateTime).toLocaleTimeString() : '—'}</span>
      </div>
    </div>
  {/if}
</div>

<!-- Follow Button -->
<button
  class="follow-button"
  class:active={isFollowingUser}
  on:click={() => { isFollowingUser = !isFollowingUser; }}
>
  <span class="follow-icon">{isFollowingUser ? '📍' : '🔓'}</span>
  {isFollowingUser ? 'Following' : 'Free'}
</button>

<!-- SDK Controls Toggle -->
<button
  class="sdk-toggle-btn"
  on:click={() => { showControls = !showControls; }}
>
  {showControls ? '✕' : '⚙️'} SDK
</button>

<!-- SDK Controls Panel -->
{#if showControls}
<div class="sdk-controls">
  <div class="sdk-header">SDK Controls</div>

  <div class="sdk-section">
    <div class="sdk-section-title">Confidence State</div>
    <div class="sdk-btn-group">
      <button
        class:active={confidenceState === 'high'}
        on:click={() => setConfidence('high')}
      >High</button>
      <button
        class:active={confidenceState === 'low'}
        on:click={() => setConfidence('low')}
      >Low</button>
      <button
        class:active={confidenceState === 'lost'}
        on:click={() => setConfidence('lost')}
      >Lost</button>
    </div>
  </div>

  <div class="sdk-section">
    <div class="sdk-section-title">Visibility</div>
    <div class="sdk-btn-group">
      <button on:click={hideMarker}>hide()</button>
      <button on:click={showMarker}>show()</button>
    </div>
  </div>

  <div class="sdk-section">
    <div class="sdk-section-title">Colors</div>
    <div class="sdk-color-row">
      <label for="dot-color">Dot</label>
      <input id="dot-color" type="color" bind:value={dotColor} on:input={() => updateDotColor(dotColor)} />
    </div>
    <div class="sdk-color-row">
      <label for="border-color">Border</label>
      <input id="border-color" type="color" bind:value={borderColor} on:input={() => updateBorderColor(borderColor)} />
    </div>
    <div class="sdk-color-row">
      <label for="ring-color">Ring</label>
      <input id="ring-color" type="color" bind:value={ringColor} on:input={() => updateRingColor(ringColor)} />
    </div>
  </div>

  <div class="sdk-section">
    <div class="sdk-section-title">Signal Lost Timing</div>
    <div class="sdk-slider-row">
      <label for="fade-start">Fade start: {signalLostFadeStart}s</label>
      <input id="fade-start" type="range" min="1" max="30" bind:value={signalLostFadeStart} />
    </div>
    <div class="sdk-slider-row">
      <label for="fade-duration">Fade duration: {signalLostFadeDuration}s</label>
      <input id="fade-duration" type="range" min="5" max="60" bind:value={signalLostFadeDuration} />
    </div>
  </div>

  <div class="sdk-section">
    <div class="sdk-section-title">Current State</div>
    <div class="sdk-state-display">
      <div>Confidence: <span class="state-value">{confidenceState}</span></div>
      <div>Hidden: <span class="state-value">{isMarkerHidden}</span></div>
      <div>Opacity: <span class="state-value">{currentOpacity.toFixed(2)}</span></div>
    </div>
  </div>
</div>
{/if}

<style>
  .map-container {
    width: 100%;
    height: 100%;
    background: #1a1a2e;
  }

  .info-overlay {
    position: fixed;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    padding: 12px 16px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
    font-size: 13px;
    line-height: 1.6;
  }
  
  .camera-info {
    top: 20px;
    left: 20px;
  }
  
  .location-info {
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    min-width: 200px;
    pointer-events: auto;
  }
  
  .data-grid {
    margin-top: 12px;
    text-align: left;
    border-top: 1px solid rgba(255,255,255,0.1);
    padding-top: 10px;
  }
  
  .data-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11px;
  }
  
  .data-label {
    color: rgba(255,255,255,0.5);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
  }
  
  .data-value {
    color: rgba(255,255,255,0.9);
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 11px;
  }
  
  .permission-prompt, .permission-error {
    padding: 8px 0;
  }
  
  .prompt-icon, .error-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }
  
  .prompt-text, .error-text {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    margin-bottom: 12px;
    line-height: 1.4;
  }
  
  .enable-location-btn, .retry-btn {
    background: #4285F4;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .enable-location-btn:hover, .retry-btn:hover {
    background: #5a9bff;
    transform: scale(1.05);
  }
  
  .enable-location-btn:active, .retry-btn:active {
    transform: scale(0.98);
  }
  
  .info-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 4px;
  }
  
  .speed-display {
    margin: 8px 0;
  }
  
  .speed-value {
    font-size: 24px;
    font-weight: 600;
    color: #4285F4;
  }
  
  .heading-display {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 16px;
  }
  
  .heading-icon {
    font-size: 18px;
  }
  
  .altitude, .accuracy, .update-count {
    font-size: 11px;
    color: rgba(255,255,255,0.6);
    margin-top: 4px;
  }
  
  .follow-button {
    position: fixed;
    bottom: 30px;
    right: 20px;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    border: 1px solid rgba(255,255,255,0.2);
    padding: 12px 20px;
    border-radius: 30px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    font-size: 14px;
    cursor: pointer;
    z-index: 1000;
    backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.3s ease;
  }
  
  .follow-button:hover {
    background: rgba(66, 133, 244, 0.3);
  }
  
  .follow-button.active {
    background: rgba(66, 133, 244, 0.8);
    border-color: #4285F4;
  }
  
  .follow-icon {
    font-size: 16px;
  }

  /* SDK Controls */
  .sdk-toggle-btn {
    position: fixed;
    bottom: 30px;
    right: 140px;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    border: 1px solid rgba(255,255,255,0.2);
    padding: 12px 20px;
    border-radius: 30px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    font-size: 14px;
    cursor: pointer;
    z-index: 1000;
    backdrop-filter: blur(10px);
    transition: all 0.3s ease;
  }

  .sdk-toggle-btn:hover {
    background: rgba(66, 133, 244, 0.3);
  }

  .sdk-controls {
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(26, 26, 46, 0.95);
    color: white;
    padding: 16px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
    z-index: 1001;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
    min-width: 240px;
    max-height: calc(100vh - 60px);
    overflow-y: auto;
  }

  .sdk-header {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    color: #4285F4;
  }

  .sdk-section {
    margin-bottom: 16px;
  }

  .sdk-section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 8px;
  }

  .sdk-btn-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .sdk-btn-group button {
    padding: 8px 14px;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    background: rgba(255,255,255,0.05);
    color: white;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sdk-btn-group button:hover {
    background: rgba(255,255,255,0.1);
  }

  .sdk-btn-group button.active {
    background: #4285F4;
    border-color: #4285F4;
  }

  .sdk-color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .sdk-color-row label {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
  }

  .sdk-color-row input[type="color"] {
    width: 40px;
    height: 28px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
  }

  .sdk-slider-row {
    margin-bottom: 10px;
  }

  .sdk-slider-row label {
    display: block;
    font-size: 11px;
    color: rgba(255,255,255,0.7);
    margin-bottom: 4px;
  }

  .sdk-slider-row input[type="range"] {
    width: 100%;
    accent-color: #4285F4;
  }

  .sdk-state-display {
    font-size: 11px;
    color: rgba(255,255,255,0.6);
    line-height: 1.8;
  }

  .sdk-state-display .state-value {
    color: #4285F4;
    font-family: 'SF Mono', Monaco, monospace;
  }
</style>
