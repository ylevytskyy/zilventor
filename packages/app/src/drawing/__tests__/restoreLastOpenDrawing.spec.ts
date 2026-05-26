import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage/lastOpenDocument', () => ({
  getLastOpenDrawing: vi.fn(),
  clearLastOpen: vi.fn(),
}));

vi.mock('../../storage/DrawingPacker', () => ({
  unpackDrawing: vi.fn(),
}));

vi.mock('../activateDrawingDocument', () => ({
  activateDrawingDocument: vi.fn().mockResolvedValue(undefined),
}));

import { getLastOpenDrawing, clearLastOpen } from '../../storage/lastOpenDocument';
import { unpackDrawing } from '../../storage/DrawingPacker';
import { activateDrawingDocument } from '../activateDrawingDocument';
import { restoreLastOpenDrawing } from '../restoreLastOpenDrawing';
import type { DrawingDocument } from '@zilventor/shared';

const baseDrawingDoc: DrawingDocument = {
  id: 'drw-restore',
  name: 'Restored Drawing',
  units: 'mm',
  source: { partPath: 'parts/cab.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: '',
};

function makeOpfs(existsResult = true) {
  return {
    exists: vi.fn().mockResolvedValue(existsResult),
    read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    write: vi.fn(),
    delete: vi.fn(),
    listAll: vi.fn(),
  };
}

function makeKernel() {
  return {
    loadFromBytes: vi.fn().mockResolvedValue('kernel-part-id'),
    execute: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('restoreLastOpenDrawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false immediately when getLastOpenDrawing returns null', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const opfs = makeOpfs();
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(false);
    expect(opfs.exists).not.toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('happy path: reads OPFS file, unpacks, activates, returns true', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/drw-restore.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockResolvedValue(baseDrawingDoc);
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(true);
    expect(opfs.exists).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(opfs.read).toHaveBeenCalledWith('drawings/drw-restore.zidw');
    expect(unpackDrawing).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(activateDrawingDocument).toHaveBeenCalledWith(baseDrawingDoc, {
      kernel: kernel,
      opfs: opfs,
    });
    expect(clearLastOpen).not.toHaveBeenCalled();
  });

  it('OPFS file missing: clears pointer, returns false, does not call activateDrawingDocument', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/ghost.zidw',
    });
    const opfs = makeOpfs(false); // exists = false
    const kernel = makeKernel();

    const result = await restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never });

    expect(result).toBe(false);
    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });

  it('corrupt bytes (unpackDrawing throws): clears pointer, returns false, does not throw', async () => {
    (getLastOpenDrawing as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'drawing',
      opfsPath: 'drawings/corrupt.zidw',
    });
    (unpackDrawing as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('DrawingPacker: malformed manifest.json'),
    );
    const opfs = makeOpfs(true);
    const kernel = makeKernel();

    await expect(
      restoreLastOpenDrawing({ kernel: kernel as never, opfs: opfs as never }),
    ).resolves.toBe(false);

    expect(clearLastOpen).toHaveBeenCalled();
    expect(activateDrawingDocument).not.toHaveBeenCalled();
  });
});
