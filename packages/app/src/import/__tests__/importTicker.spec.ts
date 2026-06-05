import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startImportTicker } from '../importTicker';

describe('startImportTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls setStatus immediately with an "Importing" message', () => {
    const setStatus = vi.fn();
    const stop = startImportTicker(setStatus);
    stop(); // clean up

    expect(setStatus).toHaveBeenCalledOnce();
    expect(setStatus.mock.calls[0]![0]).toMatch(/importing/i);
  });

  it('updates status with elapsed seconds after each 1s tick', () => {
    const setStatus = vi.fn();
    const stop = startImportTicker(setStatus);

    vi.advanceTimersByTime(3000);
    stop();

    // 3 interval ticks fired: 1s, 2s, 3s
    expect(setStatus).toHaveBeenCalledTimes(4); // 1 immediate + 3 ticks
    const lastCall = setStatus.mock.calls[3]![0] as string;
    expect(lastCall).toMatch(/3s|0:03/i);
  });

  it('formats as mm:ss once elapsed >= 60s', () => {
    const setStatus = vi.fn();
    const stop = startImportTicker(setStatus);

    vi.advanceTimersByTime(65_000); // 65s
    stop();

    const calls = setStatus.mock.calls.map((c) => c[0] as string);
    const after65 = calls[calls.length - 1]!;
    // Should contain "1:05" (1 minute 5 seconds)
    expect(after65).toContain('1:05');
  });

  it('does not call setStatus after stop() is called', () => {
    const setStatus = vi.fn();
    const stop = startImportTicker(setStatus);

    vi.advanceTimersByTime(2000);
    const callCountBeforeStop = setStatus.mock.calls.length;
    stop();

    vi.advanceTimersByTime(5000); // 5 more seconds — should NOT fire
    expect(setStatus).toHaveBeenCalledTimes(callCountBeforeStop);
  });

  it('calling stop() multiple times is safe (no throw, no extra calls)', () => {
    const setStatus = vi.fn();
    const stop = startImportTicker(setStatus);
    stop();
    const callCount = setStatus.mock.calls.length;
    expect(() => stop()).not.toThrow();
    vi.advanceTimersByTime(3000);
    expect(setStatus).toHaveBeenCalledTimes(callCount); // no extra calls
  });

  it('keeps updating status while isCurrent stays true', () => {
    const msgs: string[] = [];
    const stop = startImportTicker((m) => msgs.push(m), () => true);
    vi.advanceTimersByTime(2000);
    stop();
    // initial message + 2 ticks
    expect(msgs.length).toBe(3);
    expect(msgs[0]).toMatch(/Importing STEP/);
  });

  it('stops writing once isCurrent returns false', () => {
    let current = true;
    const msgs: string[] = [];
    const stop = startImportTicker((m) => msgs.push(m), () => current);
    vi.advanceTimersByTime(1000); // one tick written (length 2)
    current = false;
    vi.advanceTimersByTime(5000); // no further writes
    stop();
    expect(msgs.length).toBe(2);
  });
});
