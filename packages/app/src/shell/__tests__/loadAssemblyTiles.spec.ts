import { describe, it, expect, vi } from 'vitest';
import { loadAssemblyTiles } from '../loadAssemblyTiles';

describe('loadAssemblyTiles', () => {
  it('returns one tile per .zipt and .ziasm file in OPFS, with name + thumbnail data URL', async () => {
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
    expect(tiles.map((t) => t.partPath).sort()).toEqual([
      'cabinet.ziasm',
      'parts/leg.zipt',
      'parts/shelf.zipt',
    ]);
    const byPath = new Map(tiles.map((t) => [t.partPath, t]));
    expect(byPath.get('parts/leg.zipt')!.name).toBe('leg');
    expect(byPath.get('parts/shelf.zipt')!.name).toBe('shelf');
    expect(byPath.get('cabinet.ziasm')!.name).toBe('cabinet');
    for (const t of tiles) {
      expect(t.thumbnail).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('lists a .ziasm tile when only a .ziasm file is present', async () => {
    const opfs = {
      listAll: vi.fn().mockResolvedValue(['drawer.ziasm']),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const unpackProject = vi.fn().mockResolvedValue({
      manifest: {},
      blobs: {},
      thumbnail: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const tiles = await loadAssemblyTiles(opfs, unpackProject);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.partPath).toBe('drawer.ziasm');
    expect(tiles[0]!.name).toBe('drawer');
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
