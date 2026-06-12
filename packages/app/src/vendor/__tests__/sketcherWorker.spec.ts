/**
 * Unit test for sketcherWorker crash detection.
 *
 * The real `?worker` import won't resolve in jsdom — we mock the module so
 * tests can exercise the error-listener wiring without spawning a real Worker.
 *
 * Comlink.wrap only needs an object with addEventListener/postMessage/
 * removeEventListener — our FakeWorker satisfies that minimal contract.
 *
 * NOTE: vi.mock factories are hoisted before import declarations, so any
 * class/variable referenced in a factory must be defined inline (not via a
 * local variable declared below the mock call).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the Vite `?worker` import with an inline EventTarget-based stub.
// EventTarget provides addEventListener/dispatchEvent/removeEventListener which
// Comlink.wrap requires. postMessage + terminate are added as no-ops.
vi.mock('@zilventor/sketcher-worker/src/worker?worker', () => {
  class FakeWorker extends EventTarget {
    postMessage() { /* intentional no-op */ }
    terminate() { /* intentional no-op */ }
  }
  return { default: FakeWorker };
});

// Mock Comlink so we don't have to satisfy the full MessageChannel dance.
// wrap() returns the worker as-is — sufficient to test error-listener wiring.
vi.mock('comlink', () => ({
  wrap: (w: unknown) => w,
}));

// Import AFTER mocks are registered (hoisting handles the ordering).
import { createSketcherWorkerApi } from '../sketcherWorker';

describe('createSketcherWorkerApi — error listener wiring', () => {
  it('registers an error listener and calls onOffline when the worker fires an error event', () => {
    const onOffline = vi.fn();

    // Because we mocked Comlink.wrap to be identity, the returned proxy IS the
    // FakeWorker instance — cast via unknown to access EventTarget for dispatch.
    const proxy = createSketcherWorkerApi({ onOffline }) as unknown as EventTarget;

    expect(onOffline).not.toHaveBeenCalled();

    // Simulate the worker crashing.
    proxy.dispatchEvent(new Event('error'));

    expect(onOffline).toHaveBeenCalledTimes(1);
  });

  it('does NOT register a listener when onOffline is not provided', () => {
    // Should not throw.
    expect(() => createSketcherWorkerApi()).not.toThrow();
  });

  it('does NOT call onOffline from one instance when a different instance crashes', () => {
    const onOffline1 = vi.fn();
    const onOffline2 = vi.fn();

    const proxy1 = createSketcherWorkerApi({ onOffline: onOffline1 }) as unknown as EventTarget;
    const proxy2 = createSketcherWorkerApi({ onOffline: onOffline2 }) as unknown as EventTarget;

    // Crash only proxy2's worker (each call to createSketcherWorkerApi spawns
    // a fresh FakeWorker, so their EventTarget listener sets are independent).
    proxy2.dispatchEvent(new Event('error'));

    expect(onOffline2).toHaveBeenCalledTimes(1);
    expect(onOffline1).not.toHaveBeenCalled();

    // Now crash proxy1 too.
    proxy1.dispatchEvent(new Event('error'));
    expect(onOffline1).toHaveBeenCalledTimes(1);
  });
});
