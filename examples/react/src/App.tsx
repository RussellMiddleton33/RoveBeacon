import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import YouAreHereMarker from './YouAreHereMarker';
import InfoPanel from './InfoPanel';

// Default center: New York City
const DEFAULT_CENTER: [number, number] = [-74.006, 40.7128];

export default function App() {
  const [isTracking, setIsTracking] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 3D Scene */}
      <Canvas
        camera={{ position: [0, 200, 200], fov: 60 }}
        style={{ background: '#1a1a2e' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />

        {/* Ground grid */}
        <Grid
          args={[1000, 1000]}
          cellSize={10}
          cellThickness={0.5}
          cellColor="#334155"
          sectionSize={50}
          sectionThickness={1}
          sectionColor="#475569"
          fadeDistance={500}
          infiniteGrid
        />

        {/* You Are Here marker */}
        <YouAreHereMarker
          center={DEFAULT_CENTER}
          isTracking={isTracking}
          onTrackingChange={setIsTracking}
          onPermissionChange={setHasPermission}
        />

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          maxPolarAngle={Math.PI / 2.1}
        />
      </Canvas>

      {/* Info Panel Overlay */}
      <InfoPanel
        isTracking={isTracking}
        hasPermission={hasPermission}
        onStartTracking={() => setIsTracking(true)}
        onStopTracking={() => setIsTracking(false)}
      />
    </div>
  );
}
