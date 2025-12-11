<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import {
    ThreeUserMarker,
    GeolocationProvider,
    MercatorProjection,
  } from 'rovemaps-you-are-here';
  import type { LocationData } from 'rovemaps-you-are-here';

  // Configuration - set your map center coordinates
  const MAP_CENTER: [number, number] = [-74.006, 40.7128]; // NYC (longitude, latitude)
  const SCALE = 1;

  let container: HTMLDivElement;
  let isTracking = $state(false);
  let hasPermission = $state(false);
  let statusText = $state('Waiting to start...');

  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let renderer: THREE.WebGLRenderer;
  let controls: OrbitControls;
  let marker: ThreeUserMarker;
  let geoProvider: GeolocationProvider;
  let projection: MercatorProjection;
  let animationId: number;
  let clock: THREE.Clock;
  const targetPosition = new THREE.Vector3();

  function startTracking() {
    geoProvider.start();
    isTracking = true;
    statusText = 'Acquiring location...';
  }

  function stopTracking() {
    geoProvider.stop();
    isTracking = false;
    statusText = 'Tracking stopped';
  }

  function toggleTracking() {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
  }

  onMount(() => {
    // Three.js setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 50, 50);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;

    // Grid helper
    const gridHelper = new THREE.GridHelper(100, 20, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    scene.add(directionalLight);

    // Create user marker
    marker = new ThreeUserMarker({
      color: 0x4285f4,
      showAccuracyRing: true,
      showDirectionCone: true,
      orientation: 'z-up',
    });
    scene.add(marker);

    // Create projection for coordinate conversion
    projection = new MercatorProjection(MAP_CENTER, SCALE);

    // Geolocation provider
    geoProvider = new GeolocationProvider({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    });

    geoProvider.on('locationUpdate', (location: LocationData) => {
      hasPermission = true;
      const scenePos = projection.project(location.longitude, location.latitude);
      targetPosition.set(scenePos.x, 0, scenePos.y);
      marker.setPosition(targetPosition);
      marker.setAccuracy(location.accuracy * SCALE);

      if (location.heading !== null) {
        marker.setHeading(location.heading);
      }

      statusText = `Accuracy: ${location.accuracy.toFixed(1)}m`;
    });

    geoProvider.on('error', (error: Error) => {
      console.error('Location error:', error);
      statusText = `Error: ${error.message}`;
    });

    // Animation loop
    clock = new THREE.Clock();

    function animate() {
      animationId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      marker.update(delta, camera, targetPosition);
      controls.update();
      renderer.render(scene, camera);
    }

    animate();

    // Handle resize
    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });

  onDestroy(() => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
    if (geoProvider) {
      geoProvider.stop();
    }
    if (renderer) {
      renderer.dispose();
    }
  });
</script>

<div class="canvas-container" bind:this={container}></div>

<div class="info-panel">
  <div class="header">
    <h1>RoveBeacon Svelte</h1>
    <p>Three.js + Svelte 5 integration</p>
  </div>

  <div class="status-panel">
    <div class="status">
      <div class="status-dot" class:active={isTracking}></div>
      <span>{isTracking ? 'Tracking Active' : 'Tracking Stopped'}</span>
    </div>

    {#if hasPermission}
      <div class="permission-info">GPS + Compass enabled</div>
    {/if}

    <div class="status-text">{statusText}</div>

    <button class:stop={isTracking} onclick={toggleTracking}>
      {isTracking ? 'Stop Tracking' : 'Start Tracking'}
    </button>
  </div>
</div>

<style>
  .canvas-container {
    width: 100%;
    height: 100%;
  }

  .info-panel {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
  }

  .header,
  .status-panel {
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 16px;
    color: white;
    pointer-events: auto;
    max-width: 300px;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .header p {
    margin: 8px 0 0;
    font-size: 14px;
    opacity: 0.8;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    font-size: 14px;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
  }

  .status-dot.active {
    background: #22c55e;
  }

  .permission-info {
    font-size: 12px;
    opacity: 0.7;
    margin-bottom: 8px;
  }

  .status-text {
    font-size: 13px;
    opacity: 0.8;
    margin-bottom: 12px;
  }

  button {
    width: 100%;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    color: white;
    background: #4285f4;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s;
  }

  button:hover {
    background: #3b78e7;
  }

  button.stop {
    background: #ef4444;
  }

  button.stop:hover {
    background: #dc2626;
  }
</style>
