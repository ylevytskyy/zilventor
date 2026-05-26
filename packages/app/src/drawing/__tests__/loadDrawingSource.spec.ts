// packages/app/src/drawing/__tests__/loadDrawingSource.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadDrawingSource } from '../loadDrawingSource';

const FAKE_BYTES_A = new Uint8Array([1, 2, 3]);
const FAKE_BYTES_B = new Uint8Array([9, 8, 7, 6]); // different bytes → different fingerprint
const FAKE_PART_ID = 'kernel-part-uuid-abc';

function makeKernel(loadFromBytesResult = FAKE_PART_ID) {
  return {
    loadFromBytes: vi.fn().mockResolvedValue(loadFromBytesResult),
    execute: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  };
}

function makeOpfs(bytes = FAKE_BYTES_A) {
  return {
    exists: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(bytes),
  };
}

describe('loadDrawingSource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads bytes, calls kernel.loadFromBytes + execute, returns { partId, sourceFingerprint }', async () => {
    const kernel = makeKernel();
    const opfs = makeOpfs();
    const result = await loadDrawingSource({ partPath: 'cabinet.zipt', kernel: kernel as never, opfs: opfs as never });
    expect(result.partId).toBe(FAKE_PART_ID);
    expect(typeof result.sourceFingerprint).toBe('string');
    expect(result.sourceFingerprint.length).toBeGreaterThan(0);
    expect(opfs.read).toHaveBeenCalledWith('cabinet.zipt');
    expect(kernel.loadFromBytes).toHaveBeenCalledWith(FAKE_BYTES_A);
    expect(kernel.execute).toHaveBeenCalledWith(FAKE_PART_ID);
  });

  it('different bytes → different sourceFingerprint (content-based change detection)', async () => {
    const kernelA = makeKernel('partA');
    const kernelB = makeKernel('partB');
    const opfsA = makeOpfs(FAKE_BYTES_A);
    const opfsB = makeOpfs(FAKE_BYTES_B);
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const rA = await fresh({ partPath: 'partA.zipt', kernel: kernelA as never, opfs: opfsA as never });
    const rB = await fresh({ partPath: 'partB.zipt', kernel: kernelB as never, opfs: opfsB as never });
    expect(rA.sourceFingerprint).not.toBe(rB.sourceFingerprint);
  });

  it('same bytes → same sourceFingerprint (deterministic)', async () => {
    const kernelA = makeKernel('p1');
    const kernelB = makeKernel('p1');
    const opfsA = makeOpfs(FAKE_BYTES_A);
    const opfsB = makeOpfs(FAKE_BYTES_A);
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const r1 = await fresh({ partPath: 'pa1.zipt', kernel: kernelA as never, opfs: opfsA as never });
    const r2 = await fresh({ partPath: 'pa2.zipt', kernel: kernelB as never, opfs: opfsB as never });
    expect(r1.sourceFingerprint).toBe(r2.sourceFingerprint);
  });

  it('caches the result — second call with same partPath skips OPFS + kernel', async () => {
    const { loadDrawingSource: fresh } = await import('../loadDrawingSource');
    const kernel = makeKernel();
    const opfs = makeOpfs();
    const r1 = await fresh({ partPath: 'cabinet2.zipt', kernel: kernel as never, opfs: opfs as never });
    const r2 = await fresh({ partPath: 'cabinet2.zipt', kernel: kernel as never, opfs: opfs as never });
    expect(r1.partId).toBe(r2.partId);
    expect(r1.sourceFingerprint).toBe(r2.sourceFingerprint);
    expect(opfs.read).toHaveBeenCalledTimes(1);
    expect(kernel.loadFromBytes).toHaveBeenCalledTimes(1);
  });

  it('falls back to activePartId + djb2(activePartId) fingerprint when OPFS read throws', async () => {
    const kernel = makeKernel();
    const opfs = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockRejectedValue(new Error('not found in OPFS')),
    };
    const result = await loadDrawingSource({
      partPath: 'kernel-part-uuid-xyz.zipt',
      kernel: kernel as never,
      opfs: opfs as never,
      activePartId: 'kernel-part-uuid-xyz',
    });
    expect(result.partId).toBe('kernel-part-uuid-xyz');
    // Test-fixture path: fingerprint is djb2 of the partId string (acceptable only for synthetic paths)
    expect(typeof result.sourceFingerprint).toBe('string');
    expect(result.sourceFingerprint.length).toBeGreaterThan(0);
    expect(kernel.loadFromBytes).not.toHaveBeenCalled();
  });

  it('throws OPFS_READ_FAILED when OPFS read fails and no activePart fallback matches', async () => {
    const kernel = makeKernel();
    const opfs = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn().mockRejectedValue(new Error('no such file')),
    };
    await expect(
      loadDrawingSource({ partPath: 'missing.zipt', kernel: kernel as never, opfs: opfs as never })
    ).rejects.toThrow('OPFS_READ_FAILED');
  });
});
