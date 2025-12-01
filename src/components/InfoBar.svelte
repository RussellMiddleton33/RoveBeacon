<script lang="ts">
  import { fade } from 'svelte/transition';

  export let lastUpdate: number | null = null;
  export let longitude: number | null = null;
  export let latitude: number | null = null;

  let flash = false;
  let lastUpdateTs = 0;
  let updateIntervals: number[] = [];
  let avgInterval = 0;

  $: if (lastUpdate && lastUpdate !== lastUpdateTs) {
    const now = Date.now();
    if (lastUpdateTs > 0) {
        const interval = now - lastUpdateTs;
        updateIntervals = [...updateIntervals.slice(-4), interval]; // Keep last 5
        avgInterval = updateIntervals.reduce((a, b) => a + b, 0) / updateIntervals.length;
    }
    lastUpdateTs = now;
    
    flash = true;
    setTimeout(() => flash = false, 500);
  }
</script>

<div class="info-bar" class:flash={flash}>
  <div class="content">
    {#if longitude && latitude}
      <span class="coords">
        {latitude.toFixed(5)}, {longitude.toFixed(5)}
      </span>
      <div class="meta-row">
        <span class="time">
            {new Date(lastUpdate || Date.now()).toLocaleTimeString()}
        </span>
        {#if avgInterval > 0}
            <span class="freq">
                ~{(avgInterval / 1000).toFixed(1)}s
            </span>
        {/if}
      </div>
    {:else}
      <span>Waiting for location...</span>
    {/if}
  </div>
  <div class="indicator" class:active={flash}></div>
</div>

<style>
  .meta-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .freq {
    font-size: 10px;
    color: #888;
    background: #eee;
    padding: 1px 4px;
    border-radius: 4px;
  }

  .info-bar {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9);
    padding: 12px 20px;
    border-radius: 30px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 10px;
    transition: transform 0.2s;
    z-index: 1000;
    min-width: 200px;
    justify-content: center;
  }

  .info-bar.flash {
    transform: translateX(-50%) scale(1.05);
  }

  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .coords {
    font-weight: bold;
    font-size: 14px;
    color: #333;
  }

  .time {
    font-size: 10px;
    color: #666;
  }

  .indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ccc;
    transition: background 0.3s;
  }

  .indicator.active {
    background: #4285F4;
    box-shadow: 0 0 10px #4285F4;
  }
</style>

