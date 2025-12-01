<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let fov = 60;
  export let near = 10;
  export let far = 1000000;
  export let scale = 1;

  let isOpen = false;

  const dispatch = createEventDispatcher();

  function update() {
    dispatch('update', { fov, near, far, scale });
  }
  
  function toggle() {
    isOpen = !isOpen;
  }
</script>

<div class="debug-container">
  <button class="toggle-btn" on:click={toggle}>
    {isOpen ? '✕' : '⚙️'}
  </button>
  
  {#if isOpen}
    <div class="controls">
      <h3>Camera Debug</h3>
      
      <div class="control-group">
        <label>
          FOV ({fov})
          <input type="range" min="10" max="120" bind:value={fov} on:input={update} />
        </label>
      </div>

      <div class="control-group">
        <label>
          Near Plane ({near})
          <input type="range" min="0.1" max="1000" step="0.1" bind:value={near} on:input={update} />
        </label>
      </div>

      <div class="control-group">
        <label>
          Far Plane ({far})
          <input type="range" min="1000" max="5000000" step="1000" bind:value={far} on:input={update} />
        </label>
      </div>
    </div>
  {/if}
</div>

<style>
  .debug-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2000;
  }
  
  .toggle-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(26, 26, 46, 0.9);
    color: white;
    border: 1px solid rgba(255,255,255,0.2);
    font-size: 18px;
    cursor: pointer;
    backdrop-filter: blur(10px);
    transition: all 0.2s ease;
  }
  
  .toggle-btn:hover {
    background: rgba(66, 133, 244, 0.5);
  }

  .controls {
    margin-top: 10px;
    background: rgba(26, 26, 46, 0.95);
    color: white;
    padding: 15px;
    border-radius: 12px;
    width: 200px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
  }

  h3 {
    margin: 0 0 10px 0;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgba(255,255,255,0.5);
  }

  .control-group {
    margin-bottom: 12px;
  }

  label {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    gap: 5px;
    color: rgba(255,255,255,0.8);
  }

  input[type="range"] {
    width: 100%;
    accent-color: #4285F4;
  }
</style>
