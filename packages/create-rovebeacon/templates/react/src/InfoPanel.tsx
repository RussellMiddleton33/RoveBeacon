interface InfoPanelProps {
  isTracking: boolean;
  hasPermission: boolean;
  onStartTracking: () => void;
  onStopTracking: () => void;
}

export default function InfoPanel({
  isTracking,
  hasPermission,
  onStartTracking,
  onStopTracking,
}: InfoPanelProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(10px)',
          borderRadius: 12,
          padding: 16,
          color: 'white',
          pointerEvents: 'auto',
          maxWidth: 300,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          RoveBeacon React
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14, opacity: 0.8 }}>
          Three.js + React Three Fiber
        </p>
      </div>

      <div
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(10px)',
          borderRadius: 12,
          padding: 16,
          color: 'white',
          pointerEvents: 'auto',
          maxWidth: 300,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: isTracking ? '#22c55e' : '#ef4444',
            }}
          />
          <span style={{ fontSize: 14 }}>
            {isTracking ? 'Tracking Active' : 'Tracking Stopped'}
          </span>
        </div>

        {hasPermission && (
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
            GPS + Compass enabled
          </div>
        )}

        <button
          onClick={isTracking ? onStopTracking : onStartTracking}
          style={{
            width: '100%',
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 600,
            color: 'white',
            background: isTracking ? '#ef4444' : '#4285f4',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {isTracking ? 'Stop Tracking' : 'Start Tracking'}
        </button>
      </div>
    </div>
  );
}
