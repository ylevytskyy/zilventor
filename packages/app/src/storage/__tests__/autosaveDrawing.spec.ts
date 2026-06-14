import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lastOpenDocument', () => ({
  setLastOpenDrawing: vi.fn(),
}));

import { setLastOpenDrawing } from '../lastOpenDocument';
import { autosaveDrawing, withOpfsLock } from '../autosaveDrawing';
import type { DrawingDocument } from '@zilventor/shared';

function makeOpfs() {
  return { write: vi.fn().mockResolvedValue(undefined) };
}

const baseDrawingDoc: DrawingDocument = {
  id: 'drw-aabb',
  name: 'My Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

describe('autosaveDrawing', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('writes packed bytes to drawings/<id>.zidw', async () => {
    const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([10, 20, 30]));
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(mockPackDrawing).toHaveBeenCalledWith(baseDrawingDoc);
    expect(opfs.write).toHaveBeenCalledWith('drawings/drw-aabb.zidw', new Uint8Array([10, 20, 30]));
  });

  it('calls setLastOpenDrawing with the write path', async () => {
    const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(setLastOpenDrawing).toHaveBeenCalledWith('drawings/drw-aabb.zidw');
  });

  it('writes the exact bytes returned by packDrawing (no mutation)', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const mockPackDrawing = vi.fn().mockResolvedValue(payload);
    const opfs = makeOpfs();

    await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });

    expect(opfs.write).toHaveBeenCalledWith('drawings/drw-aabb.zidw', payload);
  });

  it('does not call setLastOpenDrawing when opfs.write rejects', async () => {
    const writeError = new Error('disk full');
    const opfs = { write: vi.fn().mockRejectedValue(writeError) };
    const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(
      autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing }),
    ).rejects.toThrow('disk full');
    expect(setLastOpenDrawing).not.toHaveBeenCalled();
  });

  it('routes opfs.write through navigator.locks.request when available', async () => {
    const mockRequest = vi.fn().mockImplementation((_name: string, fn: () => Promise<void>) => fn());
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = { request: mockRequest } as unknown as LockManager;
    try {
      const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const opfs = makeOpfs();
      await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });
      expect(mockRequest).toHaveBeenCalledWith('opfs:drawings/drw-aabb.zidw', expect.any(Function));
      expect(opfs.write).toHaveBeenCalled();
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });

  it('falls back to direct write when navigator.locks is absent', async () => {
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = undefined;
    try {
      const mockPackDrawing = vi.fn().mockResolvedValue(new Uint8Array([42]));
      const opfs = makeOpfs();
      await autosaveDrawing({ doc: baseDrawingDoc, opfs: opfs as never, packDrawing: mockPackDrawing });
      expect(opfs.write).toHaveBeenCalledWith('drawings/drw-aabb.zidw', new Uint8Array([42]));
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });
});

describe('withOpfsLock', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('calls navigator.locks.request with the given name and runs fn', async () => {
    const mockRequest = vi.fn().mockImplementation((_name: string, fn: () => Promise<string>) => fn());
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = { request: mockRequest } as unknown as LockManager;
    try {
      const result = await withOpfsLock('opfs:foo.ziasm', async () => 'done');
      expect(result).toBe('done');
      expect(mockRequest).toHaveBeenCalledWith('opfs:foo.ziasm', expect.any(Function));
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });

  it('runs fn directly when navigator.locks is absent (fallback)', async () => {
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = undefined;
    try {
      const result = await withOpfsLock('opfs:foo.ziasm', async () => 99);
      expect(result).toBe(99);
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });
});
