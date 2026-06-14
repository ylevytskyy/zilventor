import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DrawingPacker so we control the bytes.
vi.mock('../DrawingPacker', () => ({
  packDrawing: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

// Mock the OPFS singleton so tests don't touch real filesystem.
// The factory is hoisted, so we build a stable write spy inside it and
// expose it via a getter on the mock module.
const mockOpfsWrite = vi.fn().mockResolvedValue(undefined);
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn(() => Promise.resolve({ write: mockOpfsWrite })),
  },
}));

import { saveDrawingToOpfs } from '../saveDrawingToOpfs';
import type { DrawingDocument } from '@zilventor/shared';

const baseDoc: DrawingDocument = {
  id: 'drw-save1',
  name: 'Test',
  units: 'mm',
  source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

describe('saveDrawingToOpfs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpfsWrite.mockResolvedValue(undefined);
  });

  it('writes packed bytes to drawings/<id>.zidw', async () => {
    await saveDrawingToOpfs(baseDoc);
    expect(mockOpfsWrite).toHaveBeenCalledWith('drawings/drw-save1.zidw', new Uint8Array([1, 2, 3]));
  });

  it('acquires a Web Lock keyed opfs:drawings/<id>.zidw when navigator.locks is present', async () => {
    const mockRequest = vi.fn().mockImplementation((_name: string, fn: () => Promise<void>) => fn());
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = { request: mockRequest } as unknown as LockManager;
    try {
      await saveDrawingToOpfs(baseDoc);
      expect(mockRequest).toHaveBeenCalledWith('opfs:drawings/drw-save1.zidw', expect.any(Function));
      expect(mockOpfsWrite).toHaveBeenCalled();
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });

  it('falls back to direct write when navigator.locks is absent', async () => {
    const savedLocks = (navigator as unknown as Record<string, unknown>).locks;
    (navigator as unknown as Record<string, unknown>).locks = undefined;
    try {
      await saveDrawingToOpfs(baseDoc);
      expect(mockOpfsWrite).toHaveBeenCalledWith('drawings/drw-save1.zidw', new Uint8Array([1, 2, 3]));
    } finally {
      (navigator as unknown as Record<string, unknown>).locks = savedLocks;
    }
  });
});
