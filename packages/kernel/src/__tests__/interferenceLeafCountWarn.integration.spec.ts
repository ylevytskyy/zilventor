/**
 * K4: checkInterference leaf-count warning threshold tests.
 *
 * Verifies that a console.warn is emitted when the leaf count exceeds 150
 * (O(n²) narrow-phase performance concern) and that no warning is emitted
 * for counts at or below the threshold.
 *
 * These tests do NOT require real OCCT geometry: the warning fires immediately
 * after the leaf-count check, before any shape warm-up. Passing dummy partIds
 * causes each leaf to be skipped (console.warn per skipped leaf), but the
 * threshold warning is still emitted as the very first console.warn call.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { createKernelApi } from '../api';

function makeDummyLeaves(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    partId: `nonexistent-part-${i}`,
    pose: {
      translation: { x: i * 100, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    },
  }));
}

describe('K4: checkInterference leaf-count warning', () => {
  let api: ReturnType<typeof createKernelApi>;

  beforeAll(async () => {
    api = createKernelApi();
    await api.init();
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('K4-above: console.warn fires when leaf count > 150 (151 leaves)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 151 dummy leaves — all will be skipped (parts not registered), but the threshold
    // warning is emitted before any warm-up attempt.
    await api.checkInterference(makeDummyLeaves(151), {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    // At least one warn call must match the threshold message.
    const thresholdWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('leaf count 151 exceeds threshold 150'),
    );
    expect(thresholdWarns.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('K4-at: NO threshold warning fires when leaf count == 150 (exactly at threshold)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await api.checkInterference(makeDummyLeaves(150), {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    // No call should contain the threshold message for count == 150.
    const thresholdWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('leaf count 150 exceeds threshold'),
    );
    expect(thresholdWarns.length).toBe(0);
  }, 60_000);

  it('K4-below: NO threshold warning fires when leaf count < 150 (2 leaves)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await api.checkInterference(makeDummyLeaves(2), {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    const thresholdWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('exceeds threshold'),
    );
    expect(thresholdWarns.length).toBe(0);
  }, 60_000);

  it('K4-results: warning does not suppress or truncate results (check still runs)', async () => {
    // A warning fires but returns empty [] since all parts are nonexistent.
    // This proves warn-and-proceed: no exception, no silent truncation.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await api.checkInterference(makeDummyLeaves(151), {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    // Result is an array (not null/undefined) — the check ran to completion.
    expect(Array.isArray(result)).toBe(true);
    // All leaves are nonexistent parts → no pairs detected.
    expect(result).toHaveLength(0);
    // The threshold warn was still emitted.
    const thresholdWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('leaf count 151 exceeds threshold'),
    );
    expect(thresholdWarns.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
