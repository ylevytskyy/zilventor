// packages/app/src/commands/__tests__/AddSectionViewCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddSectionViewCommand } from '../AddSectionViewCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, SectionView, StepSegment } from '@zilventor/shared';

// ── Kernel / cache mocks ──────────────────────────────────────────────────
vi.mock('../../kernel/cutBySectionPlane', () => ({
  cutBySectionPlane: vi.fn(),
  cutAssemblyBySectionPlane: vi.fn(),
  cutByStepSegments: vi.fn(),              // F1.2 — added in Batch 2
  cutAssemblyByStepSegments: vi.fn(),      // F1.2 — added in Batch 2
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
  // F1.2 — added in Batch 1
  deriveStepPlanes: vi.fn().mockReturnValue([
    { origin: { x: 0,  y: 0,  z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    { origin: { x: 60, y: 0,  z: 0 }, normal: { x: 1, y: 0, z: 0 } },
    { origin: { x: 60, y: 30, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  ]),
  validateSteppedInvariant: vi.fn(),       // throws when clause fails; default = no-op
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

import { cutBySectionPlane, cutByStepSegments } from '../../kernel/cutBySectionPlane';
import { sectionCache } from '../../drawing/sectionCache';
import { validateSteppedInvariant } from '@zilventor/shared/src/drawing/sectionPlane';

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
  dimensionGroups: [],
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
  // F1.2 — Batch 3 mocks
  (cutByStepSegments as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    compound: {},
    faceTags: new Map(),
  });
  (validateSteppedInvariant as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
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
    // Capture full-section key for structural comparison
    const fullCmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' });
    await fullCmd.apply();
    const fullCacheKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;

    vi.clearAllMocks();
    (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, compound: {}, faceTags: new Map() });

    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'half', cutSide: 1 });
    await cmd.apply();

    const putCall = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const halfCacheKey = putCall?.[0] as string;
    expect(halfCacheKey).toBeDefined();
    expect(fullCacheKey).toBeDefined();
    // Half-section key must be structurally different from full-section key on the same parent
    expect(halfCacheKey).not.toBe(fullCacheKey);

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

// ── F1.2: stepped-section payload type extension ─────────────────────────
describe('AddSectionViewPayload — stepped mode type extension (F1.2)', () => {
  const segments: readonly StepSegment[] = [
    { startSheet: { x: 0, y: 0 },  endSheet: { x: 60, y: 0 } },
    { startSheet: { x: 60, y: 0 }, endSheet: { x: 60, y: 30 } },
    { startSheet: { x: 60, y: 30 }, endSheet: { x: 120, y: 30 } },
  ];

  it('payload accepts mode="stepped" with stepSegments array', () => {
    // Type-level assertion: this must compile. The instantiation also runs.
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped' as const,
      stepSegments: segments,
    });
    expect(cmd).toBeInstanceOf(AddSectionViewCommand);
  });

  it('payload still accepts mode="full" without stepSegments (regression)', () => {
    const cmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' as const });
    expect(cmd).toBeInstanceOf(AddSectionViewCommand);
  });

  it('payload still accepts mode="half" with cutSide (regression)', () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'half' as const,
      cutSide: 1 as const,
    });
    expect(cmd).toBeInstanceOf(AddSectionViewCommand);
  });
});

describe('AddSectionViewCommand.apply() — stepped-section happy path (SS-CMD-1)', () => {
  const segments: readonly StepSegment[] = [
    { startSheet: { x: 0,   y: 0 },  endSheet: { x: 60,  y: 0 } },
    { startSheet: { x: 60,  y: 0 },  endSheet: { x: 60,  y: 30 } },
    { startSheet: { x: 60,  y: 30 }, endSheet: { x: 120, y: 30 } },
  ];

  it('mode=stepped with valid 3-segment payload → sheet.views gains one SectionView with mode=stepped + stepSegments', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
    expect(sheet.views).toHaveLength(2);

    const sv = sheet.views.find((v) => v.kind === 'section') as SectionView & {
      mode?: string;
      stepSegments?: readonly StepSegment[];
      cutSide?: unknown;
      splitPlane?: unknown;
    };
    expect(sv).toBeDefined();
    expect(sv.mode).toBe('stepped');
    expect(sv.stepSegments).toEqual(segments);
    // Per spec §4.4: sectionLine on a stepped view is V0 → V_last (convenience).
    expect(sv.sectionLine.p0).toEqual({ x: 0, y: 0 });
    expect(sv.sectionLine.p1).toEqual({ x: 120, y: 30 });
    // α-invariant clause 7: cutSide and splitPlane MUST be absent.
    expect(sv.cutSide).toBeUndefined();
    expect(sv.splitPlane).toBeUndefined();
  });

  it('apply(mode=stepped) routes through cutByStepSegments, NOT cutBySectionPlane', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();
    expect(cutByStepSegments).toHaveBeenCalledTimes(1);
    expect(cutBySectionPlane).not.toHaveBeenCalled();
  });

  it('apply(mode=stepped) calls validateSteppedInvariant BEFORE plane derivation (layer 2)', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();
    // The validator must have been called at least once at the command boundary.
    expect(validateSteppedInvariant).toHaveBeenCalled();
  });
});

describe('AddSectionViewCommand.apply() — stepped α-invariant guards (SS-CMD-2 + SS-CMD-3)', () => {
  it('SS-CMD-2: mode="stepped" with stepSegments=undefined throws stepped-section-invariant-violated', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      // intentionally omit stepSegments
    });
    await expect(cmd.apply()).rejects.toThrow(/stepped-section-invariant-violated/);
    // The guard fires BEFORE kernel dispatch: no cut call should have been issued.
    expect(cutByStepSegments).not.toHaveBeenCalled();
    expect(cutBySectionPlane).not.toHaveBeenCalled();
  });

  it('SS-CMD-2b: mode="stepped" with stepSegments.length === 1 throws (clause 2: length >= 2)', async () => {
    const oneSeg: readonly StepSegment[] = [
      { startSheet: { x: 0, y: 0 }, endSheet: { x: 60, y: 0 } },
    ];
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: oneSeg,
    });
    await expect(cmd.apply()).rejects.toThrow(/stepped-section-invariant-violated/);
    expect(cutByStepSegments).not.toHaveBeenCalled();
  });

  it('SS-CMD-3: mode="stepped" with cutSide set throws (clause 7: stepped + half rejected)', async () => {
    const segments: readonly StepSegment[] = [
      { startSheet: { x: 0,  y: 0 },  endSheet: { x: 60, y: 0 } },
      { startSheet: { x: 60, y: 0 },  endSheet: { x: 60, y: 30 } },
    ];
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
      cutSide: 1,
    });
    await expect(cmd.apply()).rejects.toThrow(/stepped-section-invariant-violated/);
    // Crucially, the guard fires BEFORE plane derivation and kernel cut.
    expect(cutByStepSegments).not.toHaveBeenCalled();
  });

  it('SS-CMD-3b: when SS-CMD-3 throws, no SectionView is appended to sheet.views', async () => {
    const before = useAppStore.getState().activeDocument;
    const sheetBefore = before && before.kind === 'drawing'
      ? before.document.sheets.find((s) => s.id === 's1')!
      : null;
    const initialViewCount = sheetBefore ? sheetBefore.views.length : 0;

    const segments: readonly StepSegment[] = [
      { startSheet: { x: 0,  y: 0 }, endSheet: { x: 60, y: 0 } },
      { startSheet: { x: 60, y: 0 }, endSheet: { x: 60, y: 30 } },
    ];
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
      cutSide: -1,
    });
    await expect(cmd.apply()).rejects.toThrow();

    const after = useAppStore.getState().activeDocument;
    const sheetAfter = after && after.kind === 'drawing'
      ? after.document.sheets.find((s) => s.id === 's1')!
      : null;
    expect(sheetAfter?.views.length).toBe(initialViewCount);
  });
});

describe('AddSectionViewCommand.apply() — stepped cache key (SS-CMD-5)', () => {
  const segments: readonly StepSegment[] = [
    { startSheet: { x: 0,   y: 0 },  endSheet: { x: 60,  y: 0 } },
    { startSheet: { x: 60,  y: 0 },  endSheet: { x: 60,  y: 30 } },
    { startSheet: { x: 60,  y: 30 }, endSheet: { x: 120, y: 30 } },
  ];

  it('SS-CMD-5a: cache key matches spec §9.2 template — ends with "::stepped"', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();
    const putCall = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const cacheKey = putCall?.[0] as string;
    expect(cacheKey).toBeDefined();
    expect(cacheKey.endsWith('::stepped')).toBe(true);
    // The key must contain N=3 plane fingerprints (deriveStepPlanes mock returns 3 planes).
    // Each fingerprint is separated by '::'. Header is `${sourceId}`, trailer is `::stepped`.
    // So the count of '::' is N + 1 (sourceId, fp0, fp1, fp2, stepped → 4 separators).
    const separatorCount = (cacheKey.match(/::/g) ?? []).length;
    expect(separatorCount).toBe(4);
  });

  it('SS-CMD-5b: stepped cache key differs from full-section key on the same parent', async () => {
    const fullCmd = new AddSectionViewCommand({ ...basePayload, mode: 'full' });
    await fullCmd.apply();
    const fullKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;

    vi.clearAllMocks();
    (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, compound: {}, faceTags: new Map() });
    (cutByStepSegments as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, compound: {}, faceTags: new Map() });

    const steppedCmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await steppedCmd.apply();
    const steppedKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;

    expect(fullKey).toBeDefined();
    expect(steppedKey).toBeDefined();
    expect(steppedKey).not.toBe(fullKey);
  });

  it('SS-CMD-5c: two identical stepped applies → second uses cache hit; cutByStepSegments NOT re-invoked', async () => {
    // First apply: cache miss, cut runs.
    const cmd1 = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd1.apply();
    expect(cutByStepSegments).toHaveBeenCalledTimes(1);
    const cacheKey = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(cacheKey).toBeDefined();

    // Reset call counters but seed cache.get to RETURN a cached entry for this key.
    vi.clearAllMocks();
    (sectionCache.get as ReturnType<typeof vi.fn>).mockImplementation(async (k: string) =>
      k === cacheKey ? { brep: {}, faceTags: new Map() } : null,
    );

    // Second apply with identical payload: cache hit, cut MUST NOT be re-invoked.
    const cmd2 = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd2.apply();
    expect(cutByStepSegments).not.toHaveBeenCalled();
    expect(sectionCache.put).not.toHaveBeenCalled();
  });
});

describe('AddSectionViewCommand.revert() — stepped cache eviction (SS-CMD-4)', () => {
  const segments: readonly StepSegment[] = [
    { startSheet: { x: 0,   y: 0 },  endSheet: { x: 60,  y: 0 } },
    { startSheet: { x: 60,  y: 0 },  endSheet: { x: 60,  y: 30 } },
    { startSheet: { x: 60,  y: 30 }, endSheet: { x: 120, y: 30 } },
  ];

  it('SS-CMD-4a: apply stepped → revert → sectionCache.delete called once with the stepped cacheKey', async () => {
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();

    const putCall = (sectionCache.put as ReturnType<typeof vi.fn>).mock.calls[0];
    const steppedKey = putCall?.[0] as string;
    expect(steppedKey).toBeDefined();
    expect(steppedKey.endsWith('::stepped')).toBe(true);

    vi.clearAllMocks();
    await cmd.revert();

    expect(sectionCache.delete).toHaveBeenCalledTimes(1);
    expect(sectionCache.delete).toHaveBeenCalledWith(steppedKey);
  });

  it('SS-CMD-4b: apply stepped → revert → sheet.views.length restored to pre-apply count', async () => {
    const before = useAppStore.getState().activeDocument;
    if (!before || before.kind !== 'drawing') throw new Error('no drawing');
    const initialCount = before.document.sheets.find((s) => s.id === 's1')!.views.length;

    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();

    // Sanity: a stepped SectionView was actually added.
    const afterApply = useAppStore.getState().activeDocument;
    if (!afterApply || afterApply.kind !== 'drawing') throw new Error('no drawing');
    expect(afterApply.document.sheets.find((s) => s.id === 's1')!.views.length).toBe(initialCount + 1);

    await cmd.revert();

    const afterRevert = useAppStore.getState().activeDocument;
    if (!afterRevert || afterRevert.kind !== 'drawing') throw new Error('no drawing');
    expect(afterRevert.document.sheets.find((s) => s.id === 's1')!.views.length).toBe(initialCount);
  });

  it('SS-CMD-4c: apply stepped → revert → deep-equal store snapshot', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddSectionViewCommand({
      ...basePayload,
      mode: 'stepped',
      stepSegments: segments,
    });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});
