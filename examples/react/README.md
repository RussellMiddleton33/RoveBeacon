# RoveBeacon React Example

A complete example of using RoveBeacon with React and React Three Fiber.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (HTTPS required for geolocation)
npm run dev
```

Then open https://localhost:5173 in your browser.

## Features Demonstrated

- `useYouAreHere` hook for full marker + geolocation integration
- React Three Fiber canvas setup
- Compass heading support
- Start/stop tracking controls
- Proper cleanup on unmount

## Key Files

- `src/App.tsx` - Main app with Canvas setup
- `src/YouAreHereMarker.tsx` - Marker component using `useYouAreHere`
- `src/InfoPanel.tsx` - UI overlay with controls

## Usage Pattern

```tsx
import { Canvas } from '@react-three/fiber';
import { useYouAreHere } from 'rovemaps-you-are-here';

function Marker() {
  const { marker, update, start } = useYouAreHere({
    center: [-74.006, 40.7128], // NYC
    autoStart: true,
  });

  useFrame((_, delta) => {
    update(delta);
  });

  return <primitive object={marker} />;
}

function App() {
  return (
    <Canvas>
      <Marker />
    </Canvas>
  );
}
```

## Notes

- HTTPS is required for the Geolocation API
- iOS requires a user gesture to enable compass access
- The example uses `@react-three/drei` for OrbitControls and Grid
