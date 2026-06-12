import { describe, it, expect } from 'vitest';
import { isSupportedEnvironment } from '../checkSupport';

function makeNav(opts: { hasOpfs?: boolean } = {}): Navigator {
  const { hasOpfs = true } = opts;
  return {
    storage: hasOpfs
      ? { getDirectory: () => Promise.resolve({} as FileSystemDirectoryHandle) }
      : ({} as StorageManager),
  } as unknown as Navigator;
}

describe('isSupportedEnvironment', () => {
  it('returns false when nav.storage.getDirectory is missing', () => {
    expect(isSupportedEnvironment(makeNav({ hasOpfs: false }), true)).toBe(false);
  });

  it('returns false when secure context is false', () => {
    expect(isSupportedEnvironment(makeNav({ hasOpfs: true }), false)).toBe(false);
  });

  it('returns true when OPFS, secure context, and Worker are all present', () => {
    // jsdom provides Worker as undefined by default; but we can verify the
    // function reads the boolean passed — the Worker check is against the
    // global, which may be undefined in jsdom. Patch it if needed.
    const originalWorker = (globalThis as Record<string, unknown>)['Worker'];
    (globalThis as Record<string, unknown>)['Worker'] = class {};
    try {
      expect(isSupportedEnvironment(makeNav({ hasOpfs: true }), true)).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>)['Worker'] = originalWorker;
    }
  });

  it('returns false when Worker is undefined (even with OPFS + secure context)', () => {
    const originalWorker = (globalThis as Record<string, unknown>)['Worker'];
    (globalThis as Record<string, unknown>)['Worker'] = undefined;
    try {
      expect(isSupportedEnvironment(makeNav({ hasOpfs: true }), true)).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>)['Worker'] = originalWorker;
    }
  });
});
