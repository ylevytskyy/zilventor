import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lastOpenDocument', () => ({
  setLastOpenDrawing: vi.fn(),
}));

import { setLastOpenDrawing } from '../lastOpenDocument';
import { autosaveDrawing } from '../autosaveDrawing';
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
});
