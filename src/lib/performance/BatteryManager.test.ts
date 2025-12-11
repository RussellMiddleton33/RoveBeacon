import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BatteryManager,
  getGlobalBatteryManager,
  setGlobalBatteryManager,
} from './BatteryManager';

// Mock BatteryStatus interface
interface MockBattery {
  charging: boolean;
  level: number;
  chargingTime: number;
  dischargingTime: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function createMockBattery(overrides: Partial<MockBattery> = {}): MockBattery {
  return {
    charging: false,
    level: 0.8,
    chargingTime: Infinity,
    dischargingTime: 3600,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  };
}

describe('BatteryManager', () => {
  let originalNavigator: typeof navigator;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
  });

  afterEach(() => {
    // Reset global navigator
    if (originalNavigator) {
      vi.stubGlobal('navigator', originalNavigator);
    }
    vi.restoreAllMocks();
  });

  describe('unavailable state', () => {
    it('returns unavailable when getBattery is not supported', () => {
      vi.stubGlobal('navigator', {});

      const manager = new BatteryManager();

      expect(manager.getState()).toBe('unavailable');
      expect(manager.isAvailable()).toBe(false);
      expect(manager.getLevel()).toBeNull();
    });

    it('returns unavailable when navigator is undefined', () => {
      vi.stubGlobal('navigator', undefined);

      const manager = new BatteryManager();

      expect(manager.getState()).toBe('unavailable');
    });
  });

  describe('battery states', () => {
    it('detects normal state when battery is high', async () => {
      const mockBattery = createMockBattery({ level: 0.8, charging: false });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      // Wait for async init
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('normal');
      expect(manager.getLevel()).toBe(0.8);
      expect(manager.isCharging()).toBe(false);
      expect(manager.isAvailable()).toBe(true);
    });

    it('detects low state when battery below threshold', async () => {
      const mockBattery = createMockBattery({ level: 0.15, charging: false });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager({ lowPowerThreshold: 0.2 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('low');
    });

    it('detects critical state when battery very low', async () => {
      const mockBattery = createMockBattery({ level: 0.05, charging: false });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager({ criticalThreshold: 0.1 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('critical');
    });

    it('detects charging state regardless of level', async () => {
      const mockBattery = createMockBattery({ level: 0.05, charging: true });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('charging');
      expect(manager.isCharging()).toBe(true);
    });
  });

  describe('state change callbacks', () => {
    it('calls onBatteryStateChange when state changes', async () => {
      const onStateChange = vi.fn();
      const handlers: Record<string, () => void> = {};

      const mockBattery = createMockBattery({
        level: 0.8,
        charging: false,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
        }),
      });

      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      new BatteryManager({
        onBatteryStateChange: onStateChange,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Initial state should not fire callback (no change from initial)
      // Now simulate charging starting
      mockBattery.charging = true;
      handlers['chargingchange']?.();

      expect(onStateChange).toHaveBeenCalledWith('charging');
    });

    it('supports onStateChange listener registration', async () => {
      const handlers: Record<string, () => void> = {};
      const mockBattery = createMockBattery({
        level: 0.8,
        charging: false,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
        }),
      });

      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const listener = vi.fn();
      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const unsubscribe = manager.onStateChange(listener);

      // Simulate level drop to low
      mockBattery.level = 0.15;
      handlers['levelchange']?.();

      expect(listener).toHaveBeenCalledWith('low');

      // Unsubscribe
      unsubscribe();
      mockBattery.level = 0.05;
      handlers['levelchange']?.();

      // Should not be called again
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('configuration', () => {
    it('allows custom thresholds', async () => {
      const mockBattery = createMockBattery({ level: 0.35, charging: false });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager({
        lowPowerThreshold: 0.4, // Higher than default
        criticalThreshold: 0.2,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('low'); // 35% < 40%
    });

    it('allows changing thresholds at runtime', async () => {
      const mockBattery = createMockBattery({ level: 0.25, charging: false });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('normal'); // 25% > 20%

      manager.setThresholds(0.3, 0.15); // Raise low threshold

      expect(manager.getState()).toBe('low'); // 25% < 30%
    });
  });

  describe('getInfo', () => {
    it('returns comprehensive battery info', async () => {
      const mockBattery = createMockBattery({ level: 0.65, charging: true });
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const info = manager.getInfo();

      expect(info).toEqual({
        state: 'charging',
        level: 0.65,
        charging: true,
        available: true,
      });
    });
  });

  describe('dispose', () => {
    it('removes event listeners', async () => {
      const mockBattery = createMockBattery();
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockBattery.addEventListener).toHaveBeenCalledTimes(2);

      manager.dispose();

      expect(mockBattery.removeEventListener).toHaveBeenCalledTimes(2);
    });

    it('handles double dispose gracefully', async () => {
      const mockBattery = createMockBattery();
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.dispose();
      manager.dispose(); // Should not throw

      expect(mockBattery.removeEventListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('handles getBattery rejection gracefully', async () => {
      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockRejectedValue(new Error('Not allowed')),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getState()).toBe('unavailable');
    });

    it('ignores errors in listener callbacks', async () => {
      const handlers: Record<string, () => void> = {};
      const mockBattery = createMockBattery({
        level: 0.8,
        addEventListener: vi.fn((event: string, handler: () => void) => {
          handlers[event] = handler;
        }),
      });

      vi.stubGlobal('navigator', {
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });

      const manager = new BatteryManager();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Register a listener that throws
      manager.onStateChange(() => {
        throw new Error('Listener error');
      });

      // Should not throw
      mockBattery.level = 0.15;
      expect(() => handlers['levelchange']?.()).not.toThrow();
    });
  });
});

describe('Global BatteryManager', () => {
  afterEach(() => {
    // Reset global state
    vi.stubGlobal('navigator', {});
    setGlobalBatteryManager(new BatteryManager());
  });

  it('creates singleton on first access', () => {
    const manager1 = getGlobalBatteryManager();
    const manager2 = getGlobalBatteryManager();

    expect(manager1).toBe(manager2);
  });

  it('can be replaced with custom instance', () => {
    vi.stubGlobal('navigator', {});

    const custom = new BatteryManager({ lowPowerThreshold: 0.5 });
    setGlobalBatteryManager(custom);

    expect(getGlobalBatteryManager()).toBe(custom);
  });
});
