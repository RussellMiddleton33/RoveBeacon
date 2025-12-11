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

// DOM elements
const container = document.getElementById('app')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const toggleBtn = document.getElementById('toggle-btn')!;

// Three.js setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 50, 50);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
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
const marker = new ThreeUserMarker({
  color: 0x4285f4,
  showAccuracyRing: true,
  showDirectionCone: true,
  orientation: 'z-up',
});
scene.add(marker);

// Create projection for coordinate conversion
const projection = new MercatorProjection(MAP_CENTER, SCALE);

// Geolocation provider
const geoProvider = new GeolocationProvider({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
});

// State
let isTracking = false;
let currentLocation: LocationData | null = null;
const targetPosition = new THREE.Vector3();

// Handle location updates
geoProvider.on('locationUpdate', (location: LocationData) => {
  currentLocation = location;

  // Convert GPS coordinates to scene position
  const scenePos = projection.project(location.longitude, location.latitude);
  targetPosition.set(scenePos.x, 0, scenePos.y);

  // Update marker position
  marker.setPosition(targetPosition);
  marker.setAccuracy(location.accuracy * SCALE);

  if (location.heading !== null) {
    marker.setHeading(location.heading);
  }

  statusText.textContent = `Accuracy: ${location.accuracy.toFixed(1)}m`;
});

geoProvider.on('error', (error: Error) => {
  console.error('Location error:', error);
  statusText.textContent = `Error: ${error.message}`;
});

// Toggle tracking
function startTracking() {
  geoProvider.start();
  isTracking = true;
  statusDot.classList.add('active');
  statusText.textContent = 'Acquiring location...';
  toggleBtn.textContent = 'Stop Tracking';
  toggleBtn.classList.add('stop');
}

function stopTracking() {
  geoProvider.stop();
  isTracking = false;
  statusDot.classList.remove('active');
  statusText.textContent = 'Tracking stopped';
  toggleBtn.textContent = 'Start Tracking';
  toggleBtn.classList.remove('stop');
}

toggleBtn.addEventListener('click', () => {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
});

// Animation loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Update marker animations
  marker.update(delta, camera, targetPosition);

  // Update controls
  controls.update();

  renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start animation
animate();

// Auto-start tracking (optional - remove if you want manual start)
// startTracking();
