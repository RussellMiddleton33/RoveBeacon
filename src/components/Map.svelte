<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import * as THREE from "three";
  import { MapControls } from "three/addons/controls/MapControls.js";
  import { MercatorProjection } from "../utils/MercatorProjection";
  import DebugControls from "./DebugControls.svelte";
  import {
    YouAreHereController,
    type LocationData,
    type PermissionState,
    type YouAreHereControllerOptions,
  } from "../lib";

  export let center: [number, number] = [-122.4194, 37.7749]; // Default SF
  export let zoom: number = 16;
  export let pitch: number = 45;

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: MapControls;
  let projection: MercatorProjection;

  // SDK Controller
  let controller: YouAreHereController;

  // State for Tiles
  let tileGroup: THREE.Group;
  let loadedTiles = new Set<string>();

  // State for UI
  let currentLocation: [number, number] | null = null;
  let isFollowingUser = true;
  let confidenceState: "high" | "low" | "lost" = "high";
  let isMarkerHidden = false;

  // Color settings
  let dotColor = "#4285F4";
  let borderColor = "#ffffff";
  let ringColor = "#4285F4";

  // UI Control State
  let showControls = false;
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

  let debugParams = {
    fov: 60,
    near: 10,
    far: 1000000,
    scale: 1,
  };

  const dispatch = createEventDispatcher();
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

      // 3. Setup Controls
      controls = new MapControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = false;
      controls.minDistance = 100;
      controls.maxDistance = 500000;
      controls.maxPolarAngle = Math.PI / 2;

      // Initial camera position relative to center
      camera.position.set(centerX, centerY - 1200, 1200);
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

      // 4. Lights & Helpers
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      scene.add(
        new THREE.GridHelper(20000, 200, 0x333355, 0x222244).rotateX(
          Math.PI / 2,
        ),
      );

      tileGroup = new THREE.Group();
      scene.add(tileGroup);

      // 5. Initialize SDK Controller
      // Note: Our map tiles are Z-up.
      // SDK defaults to Z-up. Perfect match.
      controller = new YouAreHereController({
        center: center,
        scale: SCENE_SCALE,
        markerOptions: {
          color: parseInt(dotColor.replace("#", "0x")),
          borderColor: parseInt(borderColor.replace("#", "0x")),
          accuracyRingColor: parseInt(ringColor.replace("#", "0x")),
          showAccuracyRing: true,
          showDirectionCone: true,
          orientation: "z-up", // Explicitly match our Z-up scene
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

      // On first location update, snap camera immediately to user position
      if (locationInfo.updateCount === 1) {
        controls.target.copy(targetPos);
        // Also move camera position to maintain relative offset
        const offset = camera.position.clone().sub(controls.target);
        camera.position.copy(targetPos).add(offset);
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

  function setConfidence(state: "high" | "low" | "lost") {
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
    controller?.marker.setDotColor(parseInt(color.replace("#", "0x")));
  }

  function updateBorderColor(color: string) {
    controller?.marker.setBorderColor(parseInt(color.replace("#", "0x")));
  }

  function updateRingColor(color: string) {
    controller?.marker.setRingColor(parseInt(color.replace("#", "0x")));
  }

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }

    // SDK handles marker animation internally
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
    while (tileGroup.children.length > 0) {
      const child = tileGroup.children[0];
      tileGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        child.material.map?.dispose();
        child.material.dispose();
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
    loader.crossOrigin = "anonymous";
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
  {/if}
</div>

<!-- Follow Button -->
<button
  class="follow-button"
  class:active={isFollowingUser}
  on:click={() => {
    isFollowingUser = !isFollowingUser;
  }}
>
  <span class="follow-icon">{isFollowingUser ? "📍" : "🔓"}</span>
  {isFollowingUser ? "Following" : "Free"}
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
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    pointer-events: none;
    z-index: 1000;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
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

  .follow-button {
    position: fixed;
    bottom: 30px;
    right: 20px;
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
    border-color: #4285f4;
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
    max-height: calc(100vh - 60px);
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

  .sdk-state-display {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.8;
  }

  .sdk-state-display .state-value {
    color: #4285f4;
    font-family: "SF Mono", Monaco, monospace;
  }
</style>
