<script lang="ts">
  import Map from "./components/Map.svelte";
  import MapLibreMap from "./components/MapLibreMap.svelte";
  import MapBoxMap from "./components/MapBoxMap.svelte";
  import InfoBar from "./components/InfoBar.svelte";

  const START_CENTER: [number, number] = [
    -84.50861041709553, 39.08228965240582,
  ];

  // MapBox requires an access token - set yours here or via environment variable
  const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || "";

  let longitude: number | null = null;
  let latitude: number | null = null;
  let lastUpdate: number | null = null;

  // Tab state: 'threejs', 'maplibre', or 'mapbox'
  let activeTab: "threejs" | "maplibre" | "mapbox" = "threejs";

  function handleLocationUpdate(event: CustomEvent) {
    longitude = event.detail.longitude;
    latitude = event.detail.latitude;
    lastUpdate = event.detail.timestamp;
  }
</script>

<main>
  <!-- Tab Switcher -->
  <div class="tab-switcher">
    <button
      class="tab-btn"
      class:active={activeTab === "threejs"}
      on:click={() => (activeTab = "threejs")}
    >
      Three.js
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === "maplibre"}
      on:click={() => (activeTab = "maplibre")}
    >
      MapLibre GL
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === "mapbox"}
      on:click={() => (activeTab = "mapbox")}
    >
      MapBox GL
    </button>
  </div>

  {#if activeTab === "threejs"}
    <Map center={START_CENTER} on:locationUpdate={handleLocationUpdate} />
  {:else if activeTab === "maplibre"}
    <MapLibreMap
      center={START_CENTER}
      on:locationUpdate={handleLocationUpdate}
    />
  {:else}
    <MapBoxMap
      center={START_CENTER}
      accessToken={MAPBOX_ACCESS_TOKEN}
      on:locationUpdate={handleLocationUpdate}
    />
  {/if}

  <InfoBar {longitude} {latitude} {lastUpdate} />
</main>

<style>
  main {
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
    position: relative;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family: sans-serif;
  }

  .tab-switcher {
    position: fixed;
    bottom: calc(30px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 1002;
    display: flex;
    gap: 4px;
    background: rgba(26, 26, 46, 0.95);
    padding: 4px;
    border-radius: 12px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .tab-btn {
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.1);
  }

  .tab-btn.active {
    background: #4285f4;
    color: white;
  }
</style>
