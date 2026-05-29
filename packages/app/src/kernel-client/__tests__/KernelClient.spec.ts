import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKernelClient, createPendingTracker, startHeartbeat } from '../KernelClient';

describe('KernelClient', () => {
  it('forwards ping via the Comlink proxy', async () => {
    const fakeProxy = { ping: vi.fn().mockResolvedValue({ reply: 'pong' as const, echo: 'x' }) };
    const client = createKernelClient(fakeProxy as never);
    await expect(client.ping('x')).resolves.toEqual({ reply: 'pong', echo: 'x' });
  });

  it('forwards createPart and addFeature', async () => {
    const fakeProxy = {
      createPart: vi.fn().mockResolvedValue('part-1'),
      addFeature: vi.fn().mockResolvedValue(undefined)
    };
    const client = createKernelClient(fakeProxy as never);
    expect(await client.createPart('Part1')).toBe('part-1');
    await client.addFeature('part-1', { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] });
    expect(fakeProxy.addFeature).toHaveBeenCalledWith('part-1', expect.objectContaining({ kind: 'sketch' }));
  });
});

describe('createPendingTracker', () => {
  it('pending is 1 while async method is unresolved, 0 after it resolves', async () => {
    const tracker = createPendingTracker();
    let resolve!: (v: string) => void;
    const promise = new Promise<string>(r => { resolve = r; });
    const obj = { doWork: () => promise };
    const wrapped = tracker.wrap(obj);

    expect(tracker.pending).toBe(0);
    const callPromise = wrapped.doWork();
    expect(tracker.pending).toBe(1);
    resolve('done');
    await callPromise;
    expect(tracker.pending).toBe(0);
  });

  it('pending decrements on rejection', async () => {
    const tracker = createPendingTracker();
    let reject!: (e: Error) => void;
    const promise = new Promise<string>((_, r) => { reject = r; });
    const obj = { doWork: () => promise };
    const wrapped = tracker.wrap(obj);

    const callPromise = wrapped.doWork().catch(() => {});
    expect(tracker.pending).toBe(1);
    reject(new Error('boom'));
    await callPromise;
    expect(tracker.pending).toBe(0);
  });

  it('non-function props pass through unchanged', () => {
    const tracker = createPendingTracker();
    const obj = { name: 'kernel', version: 42 };
    const wrapped = tracker.wrap(obj);
    expect(wrapped.name).toBe('kernel');
    expect(wrapped.version).toBe(42);
  });
});

describe('startHeartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('FALSE-POSITIVE GUARD: never calls onOffline when isBusy is true, even after many intervals', async () => {
    const onOffline = vi.fn();
    // ping never resolves — simulates worker busy / blocked
    const ping = () => new Promise<never>(() => {});
    const stop = startHeartbeat({ ping, isBusy: () => true, onOffline });

    // Advance 10 intervals (30 s) — heartbeat must be fully suppressed
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onOffline).not.toHaveBeenCalled();
    stop();
  });

  it('calls onOffline exactly once after 2 idle timeouts (dead worker)', async () => {
    const onOffline = vi.fn();
    // ping always rejects immediately — simulates dead worker
    const ping = () => Promise.reject(new Error('dead'));
    const stop = startHeartbeat({ ping, isBusy: () => false, onOffline, intervalMs: 3000, timeoutMs: 2000, maxFailures: 2 });

    // Tick 1: advance to first interval fire + timeout
    await vi.advanceTimersByTimeAsync(3000 + 2000);
    expect(onOffline).not.toHaveBeenCalled(); // 1 failure, need 2

    // Tick 2: second interval fire
    await vi.advanceTimersByTimeAsync(3000 + 2000);
    expect(onOffline).toHaveBeenCalledTimes(1);

    // Advance more — interval must be cleared, no further calls
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onOffline).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never calls onOffline when ping resolves (healthy worker)', async () => {
    const onOffline = vi.fn();
    const ping = vi.fn().mockResolvedValue('pong');
    const stop = startHeartbeat({ ping, isBusy: () => false, onOffline });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(onOffline).not.toHaveBeenCalled();
    stop();
  });
});
