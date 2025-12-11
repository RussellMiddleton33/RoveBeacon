<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import * as THREE from "three";
  import { MapControls } from "three/addons/controls/MapControls.js";
  import { MercatorProjection } from "../utils/MercatorProjection";
  import {
    ThreeYouAreHereController,
    type LocationData,
    type PermissionState,
    type YouAreHereControllerOptions,
  } from "../lib";

  export let center: [number, number] = [-122.4194, 37.7749]; // Default SF
  export let zoom: number = 18;
  export let pitch: number = 10; // Near birds-eye view

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: MapControls;
  let projection: MercatorProjection;

  // SDK Controller
  let controller: ThreeYouAreHereController;

  // State for Tiles
  let tileGroup: THREE.Group;
  let loadedTiles = new Set<string>();

  // State for UI
  let currentLocation: [number, number] | null = null;
  let isFollowingUser = true;
  let confidenceState: "high" | "low" | "lost" | "warning" | "danger" = "high";
  let isMarkerHidden = false;

  // Color settings
  let dotColor = "#4285F4";
  let borderColor = "#ffffff";
  let ringColor = "#4285F4";
  let coneColor = "#CBD4E2";

  // Marker height in meters
  let markerHeight = 0;

  // Marker scale, ring scale, pulse speed, dot size, and dot stroke
  let markerScale = 0.75;
  let ringScale = 0.2;
  let pulseSpeed = 0.2;
  let dotSize = 8;
  let dotStrokeWidth = 2;
  let ringInnerRadius = 12;
  let ringOuterRadius = 25;

  // Auto-confidence tracking
  let autoConfidenceEnabled = true;

  // Simulation state
  let simulatedHeading: number | null = null;
  let simulatedCompass: number | null = null;
  let simulationInterval: number | null = null;

  // Fixed screen size mode (like MapLibre)
  let fixedScreenSize = true;

  // UI Control State - default to hidden on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  let showControls = !isMobile;
  let showLocationPanel = !isMobile;
  let signalLostFadeStart = 10;
  let signalLostFadeDuration = 20;

  // Debug Info
  let info = {
    zoom: zoom,
    pitch: pitch,
    bearing: 0,
  };

  // Location Info for UI
  let locationInfo = {
    speed: 0,
    heading: null as number | null,
    altitude: null as number | null,
    accuracy: 0,
    updateCount: 0,
    lastUpdateTime: 0,
  };

  // Permission state
  let locationPermission: PermissionState = "prompt";
  let locationError: string | null = null;

  const dispatch = createEventDispatcher();
  const SCENE_SCALE = 78271.48;

  function init() {
    console.log("Init started (SDK Controller)");
    try {
      // 1. Setup Scene
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      projection = new MercatorProjection(center, SCENE_SCALE);
      const [centerX, centerY] = projection.lngLatToScene(center[0], center[1]);

      // 2. Setup Camera
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;

      camera = new THREE.PerspectiveCamera(60, width / height, 10, 1000000);
      camera.up.set(0, 0, 1); // Z-up

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        logarithmicDepthBuffer: true,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      // Handle DPR changes (zoom, moving windows)
      const updateDpr = () => {
        const newDpr = window.devicePixelRatio;
        renderer.setPixelRatio(newDpr);
        // Re-listen for next change
        matchMedia(`(resolution: ${newDpr}dppx)`).addEventListener(
          "change",
          updateDpr,
          { once: true },
        );
      };
      matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      ).addEventListener("change", updateDpr, { once: true });

      // 3. Setup Controls
      controls = new MapControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = false;
      controls.minDistance = 100;
      controls.maxDistance = 500000;
      controls.maxPolarAngle = Math.PI / 2;

      // Initial camera position - true birds-eye view (directly above), zoomed in close
      camera.position.set(centerX, centerY, 150);
      controls.target.set(centerX, centerY, 0);

      controls.addEventListener("start", () => {
        isFollowingUser = false;
      });
      controls.addEventListener("change", () => {
        updateTilesBasedOnView();
        const height = camera.position.z;
        info = {
          zoom: Math.log2(40000000 / height),
          pitch: (controls.getPolarAngle() * 180) / Math.PI,
          bearing: (controls.getAzimuthalAngle() * 180) / Math.PI,
        };
      });

      // 4. Lights
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));

      tileGroup = new THREE.Group();
      scene.add(tileGroup);

      // 5. Initialize SDK Controller
      // Note: Our map tiles are Z-up.
      // SDK defaults to Z-up. Perfect match.
      controller = new ThreeYouAreHereController({
        center: center,
        scale: SCENE_SCALE,
        markerOptions: {
          color: parseInt(dotColor.replace("#", ""), 16),
          borderColor: parseInt(borderColor.replace("#", ""), 16),
          accuracyRingColor: parseInt(ringColor.replace("#", ""), 16),
          coneColor: parseInt(coneColor.replace("#", ""), 16),
          showAccuracyRing: true,
          showDirectionCone: true,
          orientation: "z-up",
        },
        geolocationOptions: {
          enableHighAccuracy: true,
        },
        onUpdate: handleLocationUpdate,
        onPermissionChange: (state) => {
          locationPermission = state;
          if (state === "denied") locationError = "Location denied";
        },
        onError: (err) => {
          console.error("SDK Error:", err);
          locationError = err.message;
        },
      });

      // Apply initial marker scale
      controller.marker.setOverallScale(markerScale);

      // Start SDK (handle errors gracefully - user may deny permission)
      controller.start(scene).catch((err) => {
        console.warn(
          "SDK start failed (this is expected if permission denied):",
          err.message,
        );
        // Error is already handled by onError callback, just log here
      });

      // Start Render Loop
      animate();

      // Initial Tiles
      setTimeout(updateTilesBasedOnView, 100);

      window.addEventListener("resize", onWindowResize);
    } catch (e) {
      console.error("Error in init:", e);
    }
  }

  function handleLocationUpdate(loc: LocationData) {
    currentLocation = [loc.longitude, loc.latitude];

    // Update local UI state
    locationInfo = {
      speed: loc.speed ?? 0,
      heading: loc.heading,
      altitude: loc.altitude,
      accuracy: loc.accuracy,
      updateCount: locationInfo.updateCount + 1,
      lastUpdateTime: loc.timestamp,
    };

    // Dispatch event to parent (App.svelte -> InfoBar)
    dispatch("locationUpdate", {
      longitude: loc.longitude,
      latitude: loc.latitude,
      timestamp: loc.timestamp,
    });

    // Camera follow logic
    if (isFollowingUser) {
      // We need to convert to scene coords just for the camera target
      // The SDK handles the marker position automatically
      const pos = projection.lngLatToScene(loc.longitude, loc.latitude);
      const targetPos = new THREE.Vector3(pos[0], pos[1], 0);

      // On first location update, snap camera to user position with desired view
      if (locationInfo.updateCount === 1) {
        controls.target.copy(targetPos);
        // Set camera for zoom ~17, birds-eye view (pitch 0 = directly above)
        camera.position.set(targetPos.x, targetPos.y, 300);
      } else {
        // Subsequent updates: smooth lerp
        controls.target.lerp(targetPos, 0.1);
      }
    }
  }

  async function requestLocationPermission() {
    try {
      // 1. Request device permissions (Compass on iOS)
      // Must be called from user interaction
      await controller.requestPermissions();

      // 2. Ensure SDK is started (requests Location)
      if (!controller.isActive()) {
        await controller.start(scene);
      }
    } catch (e) {
      console.log("Permission request failed", e);
    }
  }

  // --- UI Controls Wrappers ---

  function setConfidence(
    state: "high" | "low" | "lost" | "warning" | "danger",
  ) {
    confidenceState = state;
    if (controller) controller.marker.setConfidence(state);
  }

  function hideMarker() {
    isMarkerHidden = true;
    controller?.marker.hide();
  }

  function showMarker() {
    isMarkerHidden = false;
    controller?.marker.show();
  }

  function updateDotColor(color: string) {
    controller?.marker.setDotColor(parseInt(color.replace("#", ""), 16));
  }

  function updateBorderColor(color: string) {
    controller?.marker.setBorderColor(parseInt(color.replace("#", ""), 16));
  }

  function updateRingColor(color: string) {
    controller?.marker.setRingColor(parseInt(color.replace("#", ""), 16));
  }

  function updateConeColor(color: string) {
    controller?.marker.setConeColor(parseInt(color.replace("#", ""), 16));
  }

  function updateMarkerHeight(height: number) {
    if (!controller) return;
    const pos = controller.marker.position;
    // Height in meters - scale factor converts meters to scene units
    // At this scale, 1 meter ≈ SCENE_SCALE / 111320 (meters per degree at equator)
    const metersToScene = SCENE_SCALE / 111320;
    controller.marker.setPosition(pos.x, pos.y, height * metersToScene);
  }

  function toggleFixedScreenSize(enabled: boolean) {
    if (!controller) return;
    // Access options directly since TypeScript doesn't expose it
    (controller.marker as any).options.fixedScreenSize = enabled;
  }

  function updateMarkerScale(scale: number) {
    if (!controller) return;
    controller.marker.setOverallScale(scale);
  }

  function updatePulseSpeed(speed: number) {
    if (!controller) return;
    controller.marker.setPulseSpeed(speed);
  }

  function updateRingScale(scale: number) {
    if (!controller) return;
    controller.marker.setRingScale(scale);
  }

  function updateDotSize(size: number) {
    if (!controller) return;
    controller.marker.setDotSize(size);
  }

  function updateDotStrokeWidth(width: number) {
    if (!controller) return;
    controller.marker.setDotStrokeWidth(width);
  }

  function updateRingRadii(inner: number, outer: number) {
    if (!controller) return;
    controller.marker.setRingSize(inner, outer);
  }

  function toggleAutoConfidence(enabled: boolean) {
    if (!controller) return;
    autoConfidenceEnabled = enabled;
    if (enabled) {
      controller.marker.resetAutoConfidence();
    }
  }

  // Simulation functions
  function simulateHeading() {
    if (!controller) return;
    // Generate random heading and simulate movement
    simulatedHeading = Math.random() * 360;
    controller.marker.setHeading(simulatedHeading, 2.0); // 2 m/s to show cone
  }

  function simulateCompass() {
    if (!controller) return;
    // Generate random compass heading
    simulatedCompass = Math.random() * 360;
    controller.marker.setDeviceHeading(simulatedCompass);
    controller.marker.setHeading(null, 0); // No GPS heading, stationary
  }

  function startRotatingHeading() {
    if (!controller) return;
    stopSimulation();
    let angle = simulatedHeading ?? 0;
    simulationInterval = window.setInterval(() => {
      angle = (angle + 3) % 360; // Rotate 3 degrees per tick
      simulatedHeading = angle;
      controller.marker.setHeading(angle, 2.0);
    }, 50);
  }

  function startRotatingCompass() {
    if (!controller) return;
    stopSimulation();
    let angle = simulatedCompass ?? 0;
    simulationInterval = window.setInterval(() => {
      angle = (angle + 2) % 360; // Rotate 2 degrees per tick
      simulatedCompass = angle;
      controller.marker.setDeviceHeading(angle);
      controller.marker.setHeading(null, 0);
    }, 50);
  }

  function stopSimulation() {
    if (simulationInterval !== null) {
      clearInterval(simulationInterval);
      simulationInterval = null;
    }
  }

  function resetHeading() {
    if (!controller) return;
    stopSimulation();
    simulatedHeading = null;
    simulatedCompass = null;
    controller.marker.resetDeviceHeading();
    controller.marker.setHeading(null, 0);
  }

  // Exported methods for parent component to call
  export function setMarkerScale(scale: number) {
    if (!controller) return;
    controller.marker.setOverallScale(scale);
  }

  export function setMarkerPulseSpeed(speed: number) {
    if (!controller) return;
    controller.marker.setPulseSpeed(speed);
  }

  let lastAnimateTime = performance.now();

  function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = (now - lastAnimateTime) / 1000;
    lastAnimateTime = now;
    const clampedDt = Math.min(dt, 0.1); // Max 100ms

    if (controls) controls.update();

    // Update marker with camera info for fixed screen size scaling
    if (controller?.marker && camera && controls) {
      controller.marker.update(clampedDt, camera, controls.target);

      // Track confidence state from marker (updates UI in real-time)
      const currentConfidence = controller.marker.getConfidence();
      if (currentConfidence !== confidenceState) {
        confidenceState = currentConfidence;
      }
    }

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  function onWindowResize() {
    if (!container || !camera || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  // --- Tile Logic (Unchanged) ---

  function lngLatToTile(lng: number, lat: number, z: number) {
    const n = Math.pow(2, z);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n,
    );
    return { x, y };
  }

  function tileToLngLatBounds(x: number, y: number, z: number) {
    const n = Math.pow(2, z);
    const lon1 = (x / n) * 360 - 180;
    const lon2 = ((x + 1) / n) * 360 - 180;
    const latRad1 = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const latRad2 = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
    const lat1 = (latRad1 * 180) / Math.PI;
    const lat2 = (latRad2 * 180) / Math.PI;
    return {
      west: lon1,
      east: lon2,
      north: lat1,
      south: lat2,
    };
  }

  let lastTileUpdate = 0;
  let lastLoadedZoom = -1;
  let pendingTileLoads = 0; // Track pending tile loads for smooth transitions

  function updateTilesBasedOnView() {
    const now = Date.now();
    if (now - lastTileUpdate < 100) return;
    lastTileUpdate = now;

    if (!controls || !camera) return;

    const centerPos = controls.target;
    const [lng, lat] = projection.sceneToLngLat(centerPos.x, centerPos.y);

    const height = camera.position.distanceTo(controls.target);
    const zoomLevel = Math.floor(Math.log2(40000000 / height));
    const loadZoom = Math.max(2, Math.min(19, zoomLevel));

    // Only clear tiles after new ones are loaded (prevents flashing)
    const zoomChanged = lastLoadedZoom !== -1 && lastLoadedZoom !== loadZoom;
    const previousZoom = lastLoadedZoom;
    lastLoadedZoom = loadZoom;

    const centerTile = lngLatToTile(lng, lat, loadZoom);
    const range = 2;

    // Collect tiles to load
    const tilesToLoad: { x: number; y: number; z: number }[] = [];
    for (let x = centerTile.x - range; x <= centerTile.x + range; x++) {
      for (let y = centerTile.y - range; y <= centerTile.y + range; y++) {
        const key = `${loadZoom}/${x}/${y}`;
        if (!loadedTiles.has(key)) {
          tilesToLoad.push({ x, y, z: loadZoom });
        }
      }
    }

    if (zoomChanged && tilesToLoad.length > 0) {
      // Load new tiles first, then clear old ones after they're loaded
      pendingTileLoads = tilesToLoad.length;
      tilesToLoad.forEach((tile) => {
        loadTile(tile.x, tile.y, tile.z, () => {
          pendingTileLoads--;
          if (pendingTileLoads === 0) {
            // All new tiles loaded, now safe to clear old zoom level tiles
            clearTilesForZoom(previousZoom);
          }
        });
      });
    } else {
      // Same zoom level, just load new tiles normally
      tilesToLoad.forEach((tile) => loadTile(tile.x, tile.y, tile.z));
    }
  }

  function clearTilesForZoom(zoomLevel: number) {
    const tilesToRemove: THREE.Object3D[] = [];
    tileGroup.children.forEach((child) => {
      if ((child as any).userData?.zoom === zoomLevel) {
        tilesToRemove.push(child);
      }
    });

    tilesToRemove.forEach((child) => {
      tileGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.MeshBasicMaterial).map?.dispose();
        (child.material as THREE.MeshBasicMaterial).dispose();
      }
    });

    // Clear from loadedTiles set
    const keysToRemove: string[] = [];
    loadedTiles.forEach((key) => {
      if (key.startsWith(`${zoomLevel}/`)) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((key) => loadedTiles.delete(key));
  }

  function clearTiles() {
    while (tileGroup.children.length > 0) {
      const child = tileGroup.children[0];
      tileGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.MeshBasicMaterial).map?.dispose();
        (child.material as THREE.MeshBasicMaterial).dispose();
      }
    }
    loadedTiles.clear();
  }

  function loadTile(x: number, y: number, z: number, onLoad?: () => void) {
    const key = `${z}/${x}/${y}`;
    if (loadedTiles.has(key)) {
      onLoad?.();
      return;
    }
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
    loader.crossOrigin = "anonymous";
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

    loader.load(
      url,
      (texture) => {
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipMapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(sceneX, sceneY, 0);
        mesh.userData.zoom = z; // Track zoom level for cleanup
        tileGroup.add(mesh);
        onLoad?.();
      },
      undefined,
      () => {
        // Error loading tile, still call onLoad to prevent hanging
        onLoad?.();
      },
    );
  }

  onMount(() => {
    requestAnimationFrame(() => {
      if (container) init();
    });
  });

  onDestroy(() => {
    if (renderer) renderer.dispose();
    if (controls) controls.dispose();
    if (controller) controller.dispose();
  });

  function formatSpeed(mps: number): string {
    const mph = mps * 2.237;
    return `${mph.toFixed(1)} mph`;
  }

  function formatHeading(deg: number | null): string {
    if (deg === null) return "—";
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(deg / 45) % 8;
    return `${deg.toFixed(0)}° ${directions[index]}`;
  }
</script>

<div bind:this={container} class="map-container"></div>

<!-- Location & Camera Info -->
{#if locationPermission === "denied" || locationPermission === "unavailable"}
  <div class="location-required-overlay">
    <div class="location-required-card">
      <div class="location-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="4 2"/>
        </svg>
      </div>
      <h1>Location Required</h1>
      <p>This test environment requires your location to demonstrate the SDK features.</p>
      <p class="instructions">Please enable location access in your browser settings, then refresh and accept the location prompt.</p>
      <div class="button-group">
        <button class="enable-btn" on:click={() => window.location.reload()}>
          Refresh Page
        </button>
      </div>
    </div>
  </div>
{:else if showLocationPanel}
  <div class="info-overlay location-info">
    <div class="info-label">Location</div>

    {#if locationPermission === "prompt" || locationPermission === "requesting"}
      <div class="permission-prompt">
        <div class="prompt-icon">📍</div>
        <div class="prompt-text">
          {locationPermission === "requesting"
            ? "Requesting location..."
            : "Waiting for permission..."}
        </div>
        {#if locationPermission === "prompt"}
          <button
            class="enable-location-btn"
            on:click={requestLocationPermission}
          >
            Enable Location
          </button>
        {/if}
      </div>
    {:else if locationPermission === "denied" || locationPermission === "unavailable"}
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
          <span class="data-value"
            >{currentLocation ? currentLocation[1].toFixed(6) : "—"}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Lng</span>
          <span class="data-value"
            >{currentLocation ? currentLocation[0].toFixed(6) : "—"}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Alt</span>
          <span class="data-value"
            >{locationInfo.altitude !== null
              ? `${locationInfo.altitude.toFixed(1)}m`
              : "—"}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Speed</span>
          <span class="data-value"
            >{locationInfo.speed
              ? `${locationInfo.speed.toFixed(2)} m/s`
              : "0"}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Heading</span>
          <span class="data-value"
            >{locationInfo.heading !== null
              ? `${locationInfo.heading.toFixed(1)}°`
              : "—"}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Accuracy</span>
          <span class="data-value">±{locationInfo.accuracy.toFixed(1)}m</span>
        </div>
        <div class="data-row">
          <span class="data-label">Confidence</span>
          <span class="data-value confidence-{confidenceState}"
            >{confidenceState}</span
          >
        </div>
        <div class="data-row">
          <span class="data-label">Updates</span>
          <span class="data-value">{locationInfo.updateCount}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Last</span>
          <span class="data-value"
            >{locationInfo.lastUpdateTime
              ? new Date(locationInfo.lastUpdateTime).toLocaleTimeString()
              : "—"}</span
          >
        </div>
      </div>

      <div class="info-label camera-label">Camera</div>
      <div class="data-grid">
        <div class="data-row">
          <span class="data-label">Zoom</span>
          <span class="data-value">{info.zoom.toFixed(1)}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Pitch</span>
          <span class="data-value">{info.pitch.toFixed(0)}°</span>
        </div>
        <div class="data-row">
          <span class="data-label">Bearing</span>
          <span class="data-value">{info.bearing.toFixed(0)}°</span>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- Location Toggle Button -->
<button
  class="location-toggle-btn"
  on:click={() => {
    showLocationPanel = !showLocationPanel;
  }}
>
  {showLocationPanel ? "✕" : "📍"} Location
</button>

<!-- SDK Controls Toggle -->
<button
  class="sdk-toggle-btn"
  on:click={() => {
    showControls = !showControls;
  }}
>
  {showControls ? "✕" : "⚙️"} SDK
</button>

<!-- SDK Controls Panel -->
{#if showControls}
  <div class="sdk-controls">
    <div class="sdk-header">SDK Controls</div>

    <div class="sdk-section">
      <div class="sdk-section-title">Confidence State</div>
      <div class="sdk-btn-group">
        <button
          class:active={confidenceState === "high"}
          on:click={() => setConfidence("high")}>High</button
        >
        <button
          class:active={confidenceState === "low"}
          on:click={() => setConfidence("low")}>Low</button
        >
        <button
          class:active={confidenceState === "lost"}
          on:click={() => setConfidence("lost")}>Lost</button
        >
        <button
          class="warning-btn"
          class:active={confidenceState === "warning"}
          on:click={() => setConfidence("warning")}>Warning</button
        >
        <button
          class="danger-btn"
          class:active={confidenceState === "danger"}
          on:click={() => setConfidence("danger")}>Danger</button
        >
      </div>
      <div class="sdk-checkbox-row" style="margin-top: 8px;">
        <label for="auto-confidence">
          <input
            id="auto-confidence"
            type="checkbox"
            bind:checked={autoConfidenceEnabled}
            on:change={() => toggleAutoConfidence(autoConfidenceEnabled)}
          />
          Auto-confidence (staleness/accuracy)
        </label>
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
      <div class="sdk-section-title">Heading Simulation</div>
      <div class="sdk-btn-group">
        <button on:click={simulateHeading}>GPS Heading</button>
        <button on:click={simulateCompass}>Compass</button>
      </div>
      <div class="sdk-btn-group" style="margin-top: 6px;">
        <button on:click={startRotatingHeading}>🔄 Rotate GPS</button>
        <button on:click={startRotatingCompass}>🔄 Rotate Compass</button>
      </div>
      <div class="sdk-btn-group" style="margin-top: 6px;">
        <button on:click={resetHeading}>Reset</button>
      </div>
      {#if simulatedHeading !== null || simulatedCompass !== null}
        <div class="sdk-info" style="margin-top: 6px; font-size: 11px; color: rgba(255,255,255,0.6);">
          {#if simulatedHeading !== null}GPS: {simulatedHeading.toFixed(0)}°{/if}
          {#if simulatedCompass !== null} Compass: {simulatedCompass.toFixed(0)}°{/if}
        </div>
      {/if}
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Colors</div>
      <div class="sdk-color-row">
        <label for="dot-color">Dot</label>
        <input
          id="dot-color"
          type="color"
          bind:value={dotColor}
          on:input={() => updateDotColor(dotColor)}
        />
      </div>
      <div class="sdk-color-row">
        <label for="border-color">Border</label>
        <input
          id="border-color"
          type="color"
          bind:value={borderColor}
          on:input={() => updateBorderColor(borderColor)}
        />
      </div>
      <div class="sdk-color-row">
        <label for="ring-color">Ring</label>
        <input
          id="ring-color"
          type="color"
          bind:value={ringColor}
          on:input={() => updateRingColor(ringColor)}
        />
      </div>
      <div class="sdk-color-row">
        <label for="cone-color">Heading</label>
        <input
          id="cone-color"
          type="color"
          bind:value={coneColor}
          on:input={() => updateConeColor(coneColor)}
        />
      </div>
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Marker Size & Pulse</div>
      <div class="sdk-slider-row">
        <label for="marker-scale">Scale: {markerScale.toFixed(2)}x</label>
        <input
          id="marker-scale"
          type="range"
          min="0.1"
          max="3"
          step="0.05"
          bind:value={markerScale}
          on:input={() => updateMarkerScale(markerScale)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="ring-scale">Ring Scale: {ringScale.toFixed(2)}x</label>
        <input
          id="ring-scale"
          type="range"
          min="0.1"
          max="5"
          step="0.05"
          bind:value={ringScale}
          on:input={() => updateRingScale(ringScale)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="pulse-speed">Pulse Speed: {pulseSpeed.toFixed(2)}</label>
        <input
          id="pulse-speed"
          type="range"
          min="0"
          max="1"
          step="0.05"
          bind:value={pulseSpeed}
          on:input={() => updatePulseSpeed(pulseSpeed)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="dot-size">Dot Size: {dotSize.toFixed(0)}px</label>
        <input
          id="dot-size"
          type="range"
          min="3"
          max="30"
          step="1"
          bind:value={dotSize}
          on:input={() => updateDotSize(dotSize)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="dot-stroke">Dot Stroke: {dotStrokeWidth.toFixed(0)}px</label
        >
        <input
          id="dot-stroke"
          type="range"
          min="0"
          max="10"
          step="1"
          bind:value={dotStrokeWidth}
          on:input={() => updateDotStrokeWidth(dotStrokeWidth)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="ring-inner">Ring Inner: {ringInnerRadius}</label>
        <input
          id="ring-inner"
          type="range"
          min="2"
          max="30"
          step="1"
          bind:value={ringInnerRadius}
          on:input={() => updateRingRadii(ringInnerRadius, ringOuterRadius)}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="ring-outer">Ring Outer: {ringOuterRadius}</label>
        <input
          id="ring-outer"
          type="range"
          min="10"
          max="60"
          step="1"
          bind:value={ringOuterRadius}
          on:input={() => updateRingRadii(ringInnerRadius, ringOuterRadius)}
        />
      </div>
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Marker Height</div>
      <div class="sdk-slider-row">
        <label for="marker-height">Height: {markerHeight}m</label>
        <input
          id="marker-height"
          type="range"
          min="0"
          max="100"
          step="1"
          bind:value={markerHeight}
          on:input={() => updateMarkerHeight(markerHeight)}
        />
      </div>
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Scale Mode</div>
      <div class="sdk-checkbox-row">
        <label for="fixed-size">
          <input
            id="fixed-size"
            type="checkbox"
            bind:checked={fixedScreenSize}
            on:change={() => toggleFixedScreenSize(fixedScreenSize)}
          />
          Fixed Screen Size (like MapLibre)
        </label>
      </div>
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Signal Lost Timing</div>
      <div class="sdk-slider-row">
        <label for="fade-start">Fade start: {signalLostFadeStart}s</label>
        <input
          id="fade-start"
          type="range"
          min="1"
          max="30"
          bind:value={signalLostFadeStart}
        />
      </div>
      <div class="sdk-slider-row">
        <label for="fade-duration"
          >Fade duration: {signalLostFadeDuration}s</label
        >
        <input
          id="fade-duration"
          type="range"
          min="5"
          max="60"
          bind:value={signalLostFadeDuration}
        />
      </div>
    </div>

    <div class="sdk-section">
      <div class="sdk-section-title">Current State</div>
      <div class="sdk-state-display">
        <div>
          Confidence: <span class="state-value">{confidenceState}</span>
        </div>
        <div>Hidden: <span class="state-value">{isMarkerHidden}</span></div>
      </div>
    </div>
  </div>
{/if}

<style>
  .location-required-overlay {
    position: fixed;
    inset: 0;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 20px;
  }

  .location-required-card {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 24px;
    padding: 48px 40px;
    text-align: center;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }

  .location-icon {
    color: #4285f4;
    margin-bottom: 24px;
    animation: pulse-icon 2s ease-in-out infinite;
  }

  @keyframes pulse-icon {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
  }

  .location-required-card h1 {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    font-size: 28px;
    font-weight: 600;
    color: white;
    margin: 0 0 16px 0;
  }

  .location-required-card p {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    font-size: 16px;
    color: rgba(255, 255, 255, 0.7);
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .location-required-card .instructions {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 32px 0;
  }

  .location-required-card .button-group {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .location-required-card .enable-btn {
    background: linear-gradient(135deg, #4285f4 0%, #5a9bff 100%);
    color: white;
    border: none;
    padding: 16px 32px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(66, 133, 244, 0.4);
  }

  .location-required-card .enable-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(66, 133, 244, 0.5);
  }

  .location-required-card .enable-btn:active {
    transform: translateY(0);
  }

  .location-required-card .retry-btn {
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 16px 32px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .location-required-card .retry-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.3);
    color: white;
  }

  .location-required-card .hint {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.4);
    margin: 24px 0 0 0;
  }

  .map-container {
    width: 100%;
    width: 100%;
    height: 100dvh;
    background: #1a1a2e;
  }

  .info-overlay {
    position: fixed;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    padding: 12px 16px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 13px;
    line-height: 1.6;
  }

  .location-info {
    top: 20px;
    left: 20px;
    text-align: center;
    min-width: 200px;
    pointer-events: auto;
  }

  .data-grid {
    margin-top: 12px;
    text-align: left;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 10px;
  }

  .data-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11px;
  }

  .data-label {
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
  }

  .data-value {
    color: rgba(255, 255, 255, 0.9);
    font-family: "SF Mono", Monaco, monospace;
    font-size: 11px;
  }

  .confidence-high {
    color: #4285f4;
    font-weight: 600;
  }

  .confidence-low {
    color: #a0a0a0;
    font-weight: 600;
  }

  .confidence-lost {
    color: #888888;
    font-weight: 600;
  }

  .confidence-warning {
    color: #ff9500;
    font-weight: 600;
  }

  .confidence-danger {
    color: #ff3b30;
    font-weight: 600;
  }

  .permission-prompt,
  .permission-error {
    padding: 8px 0;
  }

  .prompt-icon,
  .error-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .prompt-text,
  .error-text {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 12px;
    line-height: 1.4;
  }

  .enable-location-btn,
  .retry-btn {
    background: #4285f4;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .enable-location-btn:hover,
  .retry-btn:hover {
    background: #5a9bff;
    transform: scale(1.05);
  }

  .enable-location-btn:active,
  .retry-btn:active {
    transform: scale(0.98);
  }

  .info-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 4px;
  }

  .camera-label {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .speed-display {
    margin: 8px 0;
  }

  .speed-value {
    font-size: 24px;
    font-weight: 600;
    color: #4285f4;
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

  .location-toggle-btn {
    position: fixed;
    bottom: calc(30px + env(safe-area-inset-bottom));
    left: 20px;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 12px 20px;
    border-radius: 30px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    font-size: 14px;
    cursor: pointer;
    z-index: 1000;
    backdrop-filter: blur(10px);
    transition: all 0.3s ease;
  }

  .location-toggle-btn:hover {
    background: rgba(66, 133, 244, 0.3);
  }

  /* SDK Controls */
  .sdk-toggle-btn {
    position: fixed;
    bottom: calc(30px + env(safe-area-inset-bottom));
    right: 140px;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 12px 20px;
    border-radius: 30px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    font-size: 14px;
    cursor: pointer;
    z-index: 1002;
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
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    z-index: 1001;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    min-width: 240px;
    max-height: calc(100dvh - 60px - env(safe-area-inset-bottom));
    overflow-y: auto;
  }

  .sdk-header {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    color: #4285f4;
  }

  .sdk-section {
    margin-bottom: 16px;
  }

  .sdk-section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 8px;
  }

  .sdk-btn-group {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .sdk-btn-group button {
    padding: 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    color: white;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .sdk-btn-group button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .sdk-btn-group button.active {
    background: #4285f4;
    border-color: #4285f4;
  }

  .sdk-btn-group button.warning-btn {
    border-color: rgba(255, 149, 0, 0.5);
  }

  .sdk-btn-group button.warning-btn:hover {
    background: rgba(255, 149, 0, 0.2);
  }

  .sdk-btn-group button.warning-btn.active {
    background: #ff9500;
    border-color: #ff9500;
  }

  .sdk-btn-group button.danger-btn {
    border-color: rgba(255, 59, 48, 0.5);
  }

  .sdk-btn-group button.danger-btn:hover {
    background: rgba(255, 59, 48, 0.2);
  }

  .sdk-btn-group button.danger-btn.active {
    background: #ff3b30;
    border-color: #ff3b30;
  }

  .sdk-color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .sdk-color-row label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
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
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 4px;
  }

  .sdk-slider-row input[type="range"] {
    width: 100%;
    accent-color: #4285f4;
  }

  .sdk-checkbox-row {
    margin-bottom: 8px;
  }

  .sdk-checkbox-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
  }

  .sdk-checkbox-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #4285f4;
    cursor: pointer;
  }

  .sdk-state-display {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.8;
  }

  .sdk-state-display .state-value {
    color: #4285f4;
    font-family: "SF Mono", Monaco, monospace;
  }

  /* Mobile responsive styles */
  @media (max-width: 768px) {
    .location-info {
      top: 10px;
      left: 10px;
      right: auto;
      max-width: calc(50% - 20px);
      font-size: 11px;
    }

    .speed-display {
      margin: 4px 0;
    }

    .speed-value {
      font-size: 18px;
    }

    .heading-display {
      font-size: 14px;
    }

    .sdk-controls {
      top: 10px;
      right: 10px;
      left: auto;
      max-width: calc(50% - 20px);
      min-width: 180px;
      padding: 12px;
      max-height: calc(100vh - 100px);
    }

    .sdk-header {
      font-size: 12px;
      margin-bottom: 12px;
    }

    .sdk-section {
      margin-bottom: 12px;
    }

    .sdk-section-title {
      font-size: 10px;
    }

    .sdk-btn-group button {
      padding: 6px 10px;
      font-size: 11px;
    }

    .sdk-color-row label {
      font-size: 11px;
    }

    .sdk-slider-row label {
      font-size: 10px;
    }

    .location-toggle-btn {
      bottom: 80px;
      left: 10px;
      padding: 10px 16px;
      font-size: 12px;
    }

    .sdk-toggle-btn {
      bottom: 80px;
      right: 10px;
      padding: 10px 16px;
      font-size: 12px;
    }

    .data-row {
      font-size: 10px;
    }

    .data-label {
      font-size: 8px;
    }

    .data-value {
      font-size: 10px;
    }
  }

  @media (max-width: 480px) {
    .location-info {
      max-width: calc(100% - 20px);
      left: 10px;
      right: 10px;
    }

    .sdk-controls {
      max-width: calc(100% - 20px);
      left: 10px;
      right: 10px;
    }

    .location-toggle-btn,
    .sdk-toggle-btn {
      bottom: 70px;
    }
  }
</style>
