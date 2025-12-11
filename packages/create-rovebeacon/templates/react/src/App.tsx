import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import YouAreHereMarker from './YouAreHereMarker';
import InfoPanel from './InfoPanel';

// Configuration - set your map center coordinates
const MAP_CENTER: [number, number] = [-74.006, 40.7128]; // NYC (longitude, latitude)

export default function App() {
  const [isTracking, setIsTracking] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  const handleStartTracking = useCallback(() => setIsTracking(true), []);
  const handleStopTracking = useCallback(() => setIsTracking(false), []);

  return (
    <>
      <Canvas
        camera={{ position: [0, 50, 50], fov: 60, near: 0.1, far: 1000 }}
        style={{ background: '#1a1a2e' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} />

        <YouAreHereMarker
          center={MAP_CENTER}
          isTracking={isTracking}
          onTrackingChange={setIsTracking}
          onPermissionChange={setHasPermission}
        />

        <Grid
          args={[100, 100]}
          cellSize={5}
          cellThickness={1}
          cellColor="#444444"
          sectionSize={20}
          sectionThickness={1.5}
          sectionColor="#222222"
          fadeDistance={200}
          infiniteGrid
        />

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2}
        />
      </Canvas>

      <InfoPanel
        isTracking={isTracking}
        hasPermission={hasPermission}
        onStartTracking={handleStartTracking}
        onStopTracking={handleStopTracking}
      />
    </>
  );
}
