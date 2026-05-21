// packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddSectionViewCommand } from '../AddSectionViewCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, SectionView } from '@zilventor/shared';

// ── Kernel / cache mocks ──────────────────────────────────────────────────
vi.mock('../../kernel/cutBySectionPlane', () => ({
  cutBySectionPlane: vi.fn(),
  cutAssemblyBySectionPlane: vi.fn(),
}));
vi.mock('../../drawing/sectionCache', () => ({
  sectionCache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../drawing/projectSectionView', () => ({
  projectSectionView: vi.fn().mockReturnValue({
    edges: [],
    hatchSegments: [],
    fingerprint: 'fp-mock',
  }),
}));
vi.mock('@zilventor/shared/src/drawing/sectionPlane', () => ({
  deriveSectionPlane: vi.fn().mockReturnValue({
    plane: { origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 1, z: 0 } },
    sectionViewMatrix: new Float64Array(16),
  }),
  deriveSplitPlane: vi.fn().mockReturnValue({
    origin: { x: 0, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
  }),
}));
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    resolveSectionSource: vi.fn().mockReturnValue({
      kind: 'part',
      id: 'src-fp',
    }),
  };
});

import { cutBySectionPlane } from '../../kernel/cutBySectionPlane';
import { sectionCache } from '../../drawing/sectionCache';

// ── Fixtures ──────────────────────────────────────────────────────────────
const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [
    {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
    },
  ],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test',
  units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

const basePayload = {
  drawingId: 'd1',
  sheetId: 's1',
  parentViewId: 'v1',
  p0: { x: 10, y: 50 } as { x: number; y: number },
  p1: { x: 190, y: 50 } as { x: number; y: number },
  arrowDirection: 1 as -1 | 1,
  dropAt: { x: 10, y: 130 } as { x: number; y: number },
  mode: 'full' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
  (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    compound: {},
    faceTags: new Map(),
  });
  // Reset cache mock: clearAllMocks() only clears call history, not implementations.
  // Explicitly reset to null so each test starts with an empty cache.
  (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe('AddSectionViewCommand.apply()', () => {
  it('happy path: drawing gains a second view with kind=section and label=A', async () => {
    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
    expect(sheet.views).toHaveLength(2);
    const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
    expect(sv).toBeDefined();
    expect(sv.label).toBe('A');
    expect(sv.parentViewId).toBe('v1');
    // Parent view is structurally unchanged
    const parent = sheet.views.find((v) => v.id === 'v1')!;
    expect(parent.kind).toBe('base');
  });

  it('cache hit: kernel cut is NOT called when cache already holds the entry', async () => {
    (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      compound: {},
      faceTags: {},
    });
    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();
    expect(cutBySectionPlane).not.toHaveBeenCalled();
  });

  it('tangent plane → throws with message about nudge', async () => {
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'tangent',
    });
    const cmd = new AddSectionViewCommand(basePayload);
    await expect(cmd.apply()).rejects.toThrow(/tangent/i);
  });

  it('empty cut → throws with message about missing geometry', async () => {
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'empty',
    });
    const cmd = new AddSectionViewCommand(basePayload);
    await expect(cmd.apply()).rejects.toThrow(/misses geometry/i);
  });

  it('parent not found → throws', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
    await expect(cmd.apply()).rejects.toThrow(/parent view not found/i);
  });
});

describe('AddSectionViewCommand.revert()', () => {
  it('apply then revert → state deep-equals pre-apply state', async () => {
    const snapshot = JSON.parse(
      JSON.stringify(useAppStore.getState().activeDocument),
    );
    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();
    const after = useAppStore.getState().activeDocument;
    expect(after).toEqual(snapshot);
  });

  it('revert frees the cache entry: sectionCache.get returns null after revert', async () => {
    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();
    // Simulate cache populated
    (sectionCache.delete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await cmd.revert();
    expect(sectionCache.delete).toHaveBeenCalledTimes(1);
  });

  it('apply → revert → re-apply rebuilds cache; final state matches second apply', async () => {
    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();
    // cache.get still returns null (deleted), so cut will be called again
    (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await cmd.apply();
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
    const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
    expect(sv).toBeDefined();
    expect(sv.label).toBe('A');
    // Kernel was called twice (once on first apply, once on re-apply)
    expect(cutBySectionPlane).toHaveBeenCalledTimes(2);
  });
});

describe('AddSectionViewCommand.revert() — half-section cache eviction (HS-CMD-3)', () => {
  it('apply half-section → revert → sectionCache.delete called with half-section cacheKey', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: 1 });
    await cmd.apply();

    const putCall = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const halfCacheKey = putCall?.[0] as string;
    expect(halfCacheKey).toBeDefined();
    // Half-section key must contain the cutSide suffix
    expect(halfCacheKey).toContain('::1');

    vi.clearAllMocks();
    await cmd.revert();

    expect(sectionCache.delete).toHaveBeenCalledTimes(1);
    expect(sectionCache.delete).toHaveBeenCalledWith(halfCacheKey);
  });

  it('apply half-section → revert → store restored to pre-apply state', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: 1 });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});

describe('AddSectionViewPayload — type extension (HS-TYPE-1)', () => {
  it('accepts mode=full without cutSide', () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' as const });
    expect(cmd).toBeInstanceOf(AddSectionViewCommand);
  });
  it('accepts mode=half with cutSide', () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half' as const, cutSide: 1 as const });
    expect(cmd).toBeInstanceOf(AddSectionViewCommand);
  });
});

describe('AddSectionViewCommand — cache key extension (HS-CMD-2)', () => {
  it('half-section cache key differs from full-section key on the same parent', async () => {
    const fullCmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' });
    await fullCmd.apply();
    const fullKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;

    vi.clearAllMocks();
    (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, compound: {}, faceTags: new Map() });

    const halfCmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: 1 });
    await halfCmd.apply();
    const halfKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;

    expect(fullKey).toBeDefined();
    expect(halfKey).toBeDefined();
    expect(halfKey).not.toBe(fullKey);
  });

  it('half-section kernel call passes splitPlane and cutSide', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: -1 });
    await cmd.apply();
    expect(cutBySectionPlane).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ origin: expect.any(Object), normal: expect.any(Object) }),
      expect.any(Number),
      expect.objectContaining({ origin: expect.any(Object), normal: expect.any(Object) }),
      -1,
    );
  });
});

describe('AddSectionViewCommand.apply() — half-section mode (HS-CMD-1)', () => {
  it('mode=half with cutSide=1 stores SectionView with mode=half, cutSide, splitPlane', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: 1 });
    await cmd.apply();
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.kind === 'section') as SectionView & { mode?: string; cutSide?: number; splitPlane?: unknown };
    expect(sv).toBeDefined();
    expect(sv.mode).toBe('half');
    expect(sv.cutSide).toBe(1);
    expect(sv.splitPlane).toBeDefined();
  });

  it('mode=half with cutSide=undefined throws half-section-invariant-violated', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half' });
    await expect(cmd.apply()).rejects.toThrow('half-section-invariant-violated');
  });

  it('mode=full stores SectionView with mode=full, no cutSide, no splitPlane', async () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' });
    await cmd.apply();
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.kind === 'section') as SectionView & { mode?: string; cutSide?: unknown; splitPlane?: unknown };
    expect(sv.mode).toBe('full');
    expect(sv.cutSide).toBeUndefined();
    expect(sv.splitPlane).toBeUndefined();
  });
});
