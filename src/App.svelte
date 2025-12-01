<script lang="ts">
  import Map from './components/Map.svelte';
  import InfoBar from './components/InfoBar.svelte';

  const START_CENTER: [number, number] = [-84.50861041709553, 39.08228965240582];

  let longitude: number | null = null;
  let latitude: number | null = null;
  let lastUpdate: number | null = null;

  function handleLocationUpdate(event: CustomEvent) {
    longitude = event.detail.longitude;
    latitude = event.detail.latitude;
    lastUpdate = event.detail.timestamp;
  }
</script>

<main>
  <Map center={START_CENTER} on:locationUpdate={handleLocationUpdate} />
  <InfoBar {longitude} {latitude} {lastUpdate} />
</main>

<style>
  main {
    width: 100vw;
    height: 100vh;
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
</style>
