import { describe, it, expect, vi } from 'vitest';
import { loadAssemblyTiles } from '../loadAssemblyTiles';

describe('loadAssemblyTiles', () => {
  it('returns one tile per .zipt file in OPFS, with name + thumbnail data URL', async () => {
    const opfs = {
      listAll: vi.fn().mockResolvedValue(['parts/leg.zipt', 'parts/shelf.zipt', 'cabinet.ziasm']),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const unpackProject = vi.fn().mockResolvedValue({
      manifest: {},
      blobs: {},
      thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const tiles = await loadAssemblyTiles(opfs, unpackProject);
    expect(tiles).toHaveLength(2);   // .zipt only, .ziasm filtered out
    expect(tiles[0]!.partPath).toBe('parts/leg.zipt');
    expect(tiles[0]!.name).toBe('leg');
    expect(tiles[0]!.thumbnail).toMatch(/^data:image\/png;base64,/);
    expect(tiles[1]!.partPath).toBe('parts/shelf.zipt');
    expect(tiles[1]!.name).toBe('shelf');
  });

  it('skips files that fail to unpack and logs to console', async () => {
    const opfs = {
      listAll: vi.fn().mockResolvedValue(['ok.zipt', 'bad.zipt']),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    let call = 0;
    const unpackProject = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return { manifest: {}, blobs: {}, thumbnail: new Uint8Array([0x89]) };
      throw new Error('corrupt');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tiles = await loadAssemblyTiles(opfs, unpackProject);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.partPath).toBe('ok.zipt');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips parts with no thumbnail', async () => {
    const opfs = {
      listAll: vi.fn().mockResolvedValue(['p.zipt']),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const unpackProject = vi.fn().mockResolvedValue({
      manifest: {},
      blobs: {},
      // no thumbnail
    });
    const tiles = await loadAssemblyTiles(opfs, unpackProject);
    expect(tiles).toHaveLength(0);
  });
});
