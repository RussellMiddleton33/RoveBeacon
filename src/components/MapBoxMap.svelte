<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import mapboxgl from "mapbox-gl";
  import "mapbox-gl/dist/mapbox-gl.css";
  import {
    MapBoxYouAreHereController,
    type LocationData,
    type PermissionState,
  } from "../lib";

  export let center: [number, number] = [-122.4194, 37.7749]; // Default SF
  export let zoom: number = 16;
  export let accessToken: string = ""; // MapBox requires an access token

  let container: HTMLDivElement;
  let map: mapboxgl.Map;
  let controller: MapBoxYouAreHereController;

  // State for UI
  let currentLocation: [number, number] | null = null;
  let isFollowingUser = true;
  let confidenceState: "high" | "low" | "lost" | "warning" | "danger" = "high";
  let isMarkerHidden = false;

  // Color settings
  let dotColor = "#4285F4";
  let borderColor = "#ffffff";
  let ringColor = "#4285F4";

  // UI Control State
  let showControls = false;

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

  function init() {
    console.log("MapBox Init started");

    // Set the access token
    if (!accessToken) {
      console.warn("MapBox requires an access token. Set the accessToken prop.");
      locationError = "MapBox access token required";
      return;
    }

    mapboxgl.accessToken = accessToken;

    // Attach mapboxgl to window for the SDK to find
    (window as any).mapboxgl = mapboxgl;

    // Create map
    map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/streets-v12",
      center: center,
      zoom: zoom,
      pitch: 0,
      bearing: 0,
    });

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Initialize SDK Controller
    controller = new MapBoxYouAreHereController({
      markerOptions: {
        color: parseInt(dotColor.replace("#", "0x")),
        borderColor: parseInt(borderColor.replace("#", "0x")),
        accuracyRingColor: parseInt(ringColor.replace("#", "0x")),
        showAccuracyRing: true,
        showDirectionCone: true,
      },
      flyToOnFirstFix: true,
      flyToZoom: 17,
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

    // Start when map is ready
    map.on("load", async () => {
      try {
        await controller.start(map);
      } catch (err: any) {
        console.warn("SDK start failed:", err.message);
      }
    });

    // Track user interaction with map
    map.on("dragstart", () => {
      isFollowingUser = false;
    });
  }

  function handleLocationUpdate(loc: LocationData) {
    currentLocation = [loc.longitude, loc.latitude];

    locationInfo = {
      speed: loc.speed ?? 0,
      heading: loc.heading,
      altitude: loc.altitude,
      accuracy: loc.accuracy,
      updateCount: locationInfo.updateCount + 1,
      lastUpdateTime: loc.timestamp,
    };

    dispatch("locationUpdate", {
      longitude: loc.longitude,
      latitude: loc.latitude,
      timestamp: loc.timestamp,
    });

    // If following, pan to user
    if (isFollowingUser && map && locationInfo.updateCount > 1) {
      map.panTo([loc.longitude, loc.latitude], { duration: 500 });
    }
  }

  async function requestLocationPermission() {
    try {
      await controller.requestPermissions();
      if (!controller.isActive()) {
        await controller.start(map);
      }
    } catch (e) {
      console.log("Permission request failed", e);
    }
  }

  function flyToUser() {
    if (controller) {
      controller.flyToUser({ zoom: 17, duration: 1000 });
      isFollowingUser = true;
    }
  }

  // UI Controls
  function setConfidence(state: "high" | "low" | "lost" | "warning" | "danger") {
    confidenceState = state;
    controller?.marker.setConfidence(state);
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

  // Exported methods for parent component to call
  export function setMarkerScale(scale: number) {
    if (!controller) return;
    controller.marker.setOverallScale(scale);
  }

  export function setMarkerPulseSpeed(speed: number) {
    if (!controller) return;
    controller.marker.setPulseSpeed(speed);
  }

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

  onMount(() => {
    if (container) init();
  });

  onDestroy(() => {
    if (controller) controller.dispose();
    if (map) map.remove();
  });
</script>

<div bind:this={container} class="map-container"></div>

<!-- Location Info -->
<div class="info-overlay location-info">
  <div class="info-label">Location (MapBox)</div>

  {#if !accessToken}
    <div class="permission-error">
      <div class="error-icon">🔑</div>
      <div class="error-text">MapBox access token required</div>
    </div>
  {:else if locationPermission === "prompt" || locationPermission === "requesting"}
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
        <span class="data-label">Accuracy</span>
        <span class="data-value">±{locationInfo.accuracy.toFixed(1)}m</span>
      </div>
      <div class="data-row">
        <span class="data-label">Updates</span>
        <span class="data-value">{locationInfo.updateCount}</span>
      </div>
    </div>
  {/if}
</div>

<!-- Follow Button -->
<button
  class="follow-button"
  class:active={isFollowingUser}
  on:click={flyToUser}
>
  <span class="follow-icon">{isFollowingUser ? "📍" : "🔓"}</span>
  {isFollowingUser ? "Following" : "Fly to Me"}
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
    <div class="sdk-header">SDK Controls (MapBox)</div>

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
    right: 160px;
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
    right: 60px;
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

  .sdk-btn-group button.warning-btn {
    border-color: rgba(255, 149, 0, 0.5);
    color: #ff9500;
  }

  .sdk-btn-group button.warning-btn:hover {
    background: rgba(255, 149, 0, 0.2);
  }

  .sdk-btn-group button.warning-btn.active {
    background: #ff9500;
    border-color: #ff9500;
    color: white;
  }

  .sdk-btn-group button.danger-btn {
    border-color: rgba(255, 59, 48, 0.5);
    color: #ff3b30;
  }

  .sdk-btn-group button.danger-btn:hover {
    background: rgba(255, 59, 48, 0.2);
  }

  .sdk-btn-group button.danger-btn.active {
    background: #ff3b30;
    border-color: #ff3b30;
    color: white;
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
