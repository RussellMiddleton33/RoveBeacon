import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  QualityManager,
  getGlobalQualityManager,
  setGlobalQualityManager,
} from './QualityManager';
import { QUALITY_PRESETS } from './QualityPresets';

describe('QualityManager', () => {
  beforeEach(() => {
    // Mock navigator
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 4,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });

    // Mock window
    vi.stubGlobal('window', {
      ontouchstart: undefined,
      screen: { width: 1920, height: 1080 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('defaults to auto preset', () => {
      const manager = new QualityManager();
      expect(manager.getCurrentPreset()).toBe('auto');
    });

    it('accepts explicit preset', () => {
      const manager = new QualityManager({ preset: 'low' });
      expect(manager.getCurrentPreset()).toBe('low');
      expect(manager.getEffectivePreset()).toBe('low');
    });
  });

  describe('getSettings', () => {
    it('returns settings matching the effective preset', () => {
      const manager = new QualityManager({ preset: 'high' });
      const settings = manager.getSettings();

      expect(settings.ringSegments).toBe(QUALITY_PRESETS.high.ringSegments);
      expect(settings.coneLayers).toBe(QUALITY_PRESETS.high.coneLayers);
      expect(settings.smoothPosition).toBe(QUALITY_PRESETS.high.smoothPosition);
    });

    it('returns a copy, not the original', () => {
      const manager = new QualityManager({ preset: 'medium' });
      const settings1 = manager.getSettings();
      const settings2 = manager.getSettings();

      expect(settings1).not.toBe(settings2);
      expect(settings1).toEqual(settings2);
    });
  });

  describe('setPreset', () => {
    it('changes the preset', () => {
      const manager = new QualityManager({ preset: 'high' });
      manager.setPreset('low');

      expect(manager.getCurrentPreset()).toBe('low');
      expect(manager.getSettings().ringSegments).toBe(16);
    });

    it('fires callback when effective preset changes', () => {
      const onQualityChange = vi.fn();
      const manager = new QualityManager({
        preset: 'high',
        onQualityChange,
      });

      manager.setPreset('low');

      expect(onQualityChange).toHaveBeenCalledTimes(1);
      expect(onQualityChange).toHaveBeenCalledWith(
        expect.objectContaining({ ringSegments: 16 }),
        'low'
      );
    });

    it('does not fire callback when preset unchanged', () => {
      const onQualityChange = vi.fn();
      const manager = new QualityManager({
        preset: 'high',
        onQualityChange,
      });

      manager.setPreset('high');

      expect(onQualityChange).not.toHaveBeenCalled();
    });
  });

  describe('auto detection', () => {
    it('detects low quality for low-end devices', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 2,
        deviceMemory: 2,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0)',
        maxTouchPoints: 5,
      });
      vi.stubGlobal('window', {
        screen: { width: 375, height: 667 },
      });

      const manager = new QualityManager({ preset: 'auto' });
      expect(manager.getDetectedPreset()).toBe('low');
    });

    it('detects high quality for high-end devices', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        maxTouchPoints: 0,
      });
      vi.stubGlobal('window', {
        screen: { width: 2560, height: 1440 },
      });

      const manager = new QualityManager({ preset: 'auto' });
      expect(manager.getDetectedPreset()).toBe('high');
    });

    it('detects mobile from user agent', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 4,
        userAgent: 'Mozilla/5.0 (Linux; Android 10)',
        maxTouchPoints: 5,
      });

      const manager = new QualityManager();
      expect(manager.isMobile()).toBe(true);
    });
  });

  describe('getDeviceInfo', () => {
    it('returns device capability info', () => {
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 6,
        deviceMemory: 4,
        userAgent: 'Test Agent',
        maxTouchPoints: 0,
      });
      vi.stubGlobal('window', {
        screen: { width: 1920, height: 1080 },
      });

      const manager = new QualityManager();
      const info = manager.getDeviceInfo();

      expect(info.cores).toBe(6);
      expect(info.memory).toBe(4);
      expect(info.isMobile).toBe(false);
      expect(['low', 'medium', 'high']).toContain(info.detectedPreset);
    });
  });

  describe('redetect', () => {
    it('updates detected preset and fires callback if changed', () => {
      const onQualityChange = vi.fn();

      // Start with high-end device
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 8,
        deviceMemory: 8,
        userAgent: 'Desktop',
        maxTouchPoints: 0,
      });
      vi.stubGlobal('window', {
        screen: { width: 2560, height: 1440 },
      });

      const manager = new QualityManager({
        preset: 'auto',
        onQualityChange,
      });

      const initial = manager.getDetectedPreset();
      expect(initial).toBe('high');

      // Simulate device change (e.g., power mode)
      vi.stubGlobal('navigator', {
        hardwareConcurrency: 2,
        deviceMemory: 2,
        userAgent: 'Mozilla/5.0 (iPhone)',
        maxTouchPoints: 5,
      });
      vi.stubGlobal('window', {
        screen: { width: 375, height: 667 },
      });

      manager.redetect();

      // Should have detected low and fired callback
      expect(manager.getDetectedPreset()).toBe('low');
      expect(onQualityChange).toHaveBeenCalledWith(
        expect.objectContaining({ ringSegments: 16 }),
        'low'
      );
    });
  });
});

describe('Global QualityManager', () => {
  afterEach(() => {
    // Reset global state
    setGlobalQualityManager(new QualityManager());
  });

  it('creates singleton on first access', () => {
    const manager1 = getGlobalQualityManager();
    const manager2 = getGlobalQualityManager();

    expect(manager1).toBe(manager2);
  });

  it('can be replaced with setGlobalQualityManager', () => {
    const custom = new QualityManager({ preset: 'low' });
    setGlobalQualityManager(custom);

    expect(getGlobalQualityManager()).toBe(custom);
    expect(getGlobalQualityManager().getCurrentPreset()).toBe('low');
  });
});
