import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnimationManager, AnimationManagerSingleton } from './AnimationManager';

describe('AnimationManager', () => {
  beforeEach(() => {
    // Reset the singleton between tests
    AnimationManager.reset();

    // Mock requestAnimationFrame
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      frameId++;
      // Execute callback immediately for testing
      setTimeout(() => cb(performance.now()), 0);
      return frameId;
    }));

    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    AnimationManager.reset();
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('starts animation loop on first registration', async () => {
      const callback = vi.fn();
      AnimationManager.register(callback);

      expect(AnimationManager.isRunning()).toBe(true);
      expect(AnimationManager.getCallbackCount()).toBe(1);

      // Wait for frame to fire
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalled();
    });

    it('returns unregister function', () => {
      const callback = vi.fn();
      const unregister = AnimationManager.register(callback);

      expect(AnimationManager.getCallbackCount()).toBe(1);

      unregister();

      expect(AnimationManager.getCallbackCount()).toBe(0);
    });

    it('stops loop when last callback unregistered', () => {
      const callback = vi.fn();
      const unregister = AnimationManager.register(callback);

      expect(AnimationManager.isRunning()).toBe(true);

      unregister();

      expect(AnimationManager.isRunning()).toBe(false);
    });

    it('handles multiple callbacks', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unregister1 = AnimationManager.register(callback1);
      const unregister2 = AnimationManager.register(callback2);

      expect(AnimationManager.getCallbackCount()).toBe(2);

      // Wait for frame to fire
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      // Unregister one
      unregister1();
      expect(AnimationManager.getCallbackCount()).toBe(1);
      expect(AnimationManager.isRunning()).toBe(true);

      // Unregister last
      unregister2();
      expect(AnimationManager.getCallbackCount()).toBe(0);
      expect(AnimationManager.isRunning()).toBe(false);
    });
  });

  describe('deltaTime', () => {
    it('passes deltaTime to callbacks', async () => {
      const callback = vi.fn();
      AnimationManager.register(callback);

      // Wait for a few frames
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      const [deltaTime] = callback.mock.calls[0];
      expect(typeof deltaTime).toBe('number');
      expect(deltaTime).toBeGreaterThanOrEqual(0);
      expect(deltaTime).toBeLessThanOrEqual(0.1); // Clamped to 100ms
    });
  });

  describe('error handling', () => {
    it('continues loop if callback throws', async () => {
      const badCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const goodCallback = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      AnimationManager.register(badCallback);
      AnimationManager.register(goodCallback);

      // Wait for frames
      await new Promise(resolve => setTimeout(resolve, 20));

      // Both should have been called
      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();

      // Error should have been logged
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('reset', () => {
    it('clears all callbacks and stops loop', () => {
      const callback = vi.fn();
      AnimationManager.register(callback);
      AnimationManager.register(callback);

      expect(AnimationManager.getCallbackCount()).toBe(2);
      expect(AnimationManager.isRunning()).toBe(true);

      AnimationManager.reset();

      expect(AnimationManager.getCallbackCount()).toBe(0);
      expect(AnimationManager.isRunning()).toBe(false);
    });
  });

  describe('configure', () => {
    it('enables frame monitoring when configured', async () => {
      const onWarning = vi.fn();

      AnimationManager.configure({
        enableMonitoring: true,
        onPerformanceWarning: onWarning,
      });

      AnimationManager.register(() => {});

      // Wait for frames
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = AnimationManager.getStats();
      expect(stats).not.toBeNull();
      expect(stats?.totalFrames).toBeGreaterThan(0);
    });

    it('returns null stats when monitoring disabled', () => {
      AnimationManager.configure({ enableMonitoring: false });
      expect(AnimationManager.getStats()).toBeNull();
      expect(AnimationManager.getFPS()).toBe(0);
    });
  });
});

describe('AnimationManagerSingleton (separate instance)', () => {
  it('can create independent instances', () => {
    const manager1 = new AnimationManagerSingleton();
    const manager2 = new AnimationManagerSingleton();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    manager1.register(callback1);
    manager2.register(callback2);

    expect(manager1.getCallbackCount()).toBe(1);
    expect(manager2.getCallbackCount()).toBe(1);

    manager1.reset();
    manager2.reset();
  });
});
