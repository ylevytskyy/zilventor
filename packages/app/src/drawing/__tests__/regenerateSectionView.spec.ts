// packages/app/src/drawing/__tests__/regenerateSectionView.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { regenerateSectionView } from '../regenerateSectionView';
import type { DrawingDocument, SectionView } from '@zilventor/shared';

// ── mock the kernel cut function ──────────────────────────────────────────
vi.mock('../../kernel/cutBySectionPlane', () => {
  const okResult = {
    ok: true as const,
    compound: { meshes: [], faces: [] },
    faceTags: new Map([['face-1', 'mat-pine']]),
  };
  return {
    cutBySectionPlane: vi.fn().mockResolvedValue(okResult),
    cutAssemblyBySectionPlane: vi.fn().mockResolvedValue(okResult),
    cutByStepSegments: vi.fn().mockResolvedValue(okResult),
    cutAssemblyByStepSegments: vi.fn().mockResolvedValue(okResult),
  };
});

// ── mock projectSectionView ───────────────────────────────────────────────
// NOTE: projectSectionView lives in drawing/projectSectionView.ts.
// From drawing/__tests__/, the correct relative path is '../projectSectionView'.
vi.mock('../projectSectionView', () => ({
  projectSectionView: vi.fn().mockReturnValue({
    edges: [{ id: 'e-new', kind: 'outline', points: [[0,0],[60,0]], sourceFaceIds: [] }],
    hatchSegments: [{ p0: { x: 1, y: 1 }, p1: { x: 59, y: 1 }, materialId: 'mat-pine' }],
    fingerprint: 'fp-regen-new',
  }),
}));

// ── mock deriveSectionPlane (used to rebuild sectionViewMatrix) ───────────
vi.mock('@zilventor/shared/src/drawing/sectionPlane', () => ({
  deriveSectionPlane: vi.fn().mockReturnValue({
    plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    sectionViewMatrix: new Float64Array(16),
  }),
  deriveSplitPlane: vi.fn(),
  deriveStepPlanes: vi.fn(),
  validateSteppedInvariant: vi.fn(),
}));

// ── mock resolveSectionSource ─────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    resolveSectionSource: vi.fn().mockReturnValue({ kind: 'part', id: 'part-uuid-1' }),
    getHatchSpec: vi.fn().mockReturnValue({ angleDeg: 45, spacingMm: 3 }),
  };
});

// ── mock CommandBus (section regenerate does NOT route through RegenerateViewCommand) ──
// Section regenerate writes atomically via useAppStore.setState(drawingDocState(...));
// it does NOT call bus.execute. The bus parameter is kept for API symmetry with
// regenerateDetailView and in case future callers need it, but sections bypass it.
const fakeBus = { execute: vi.fn().mockResolvedValue(undefined) };

const SECTION_VIEW_FULL: SectionView = {
  id: 'sec-1',
  kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1,
  label: 'A',
  positionMm: { x: 200, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'full',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  hatchSegments: [],
  fingerprint: 'old-fp',
  projection: {
    visibleEdges: [{ id: 'e-old', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 0 },
  },
  inputFingerprint: 'old-source-fp',
};

const BASE_VIEW = {
  id: 'base-1',
  kind: 'base' as const,
  positionMm: { x: 80, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front' as const,
  showHidden: false,
  viewMatrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline' as const, points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  inputFingerprint: 'new-source-fp',
};

function makeDrawingWithSection(): DrawingDocument {
  return {
    id: 'drw-1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_VIEW as never, SECTION_VIEW_FULL],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('regenerateSectionView — full mode, part source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [{ id: 'mat-pine', name: 'Pine', defaultThickness: 18, color: '#D2A679' }], featureTree: [], parameters: {} } as never,
      kernel: { execute: vi.fn(), getProjectorInput: vi.fn() } as never,
    });
  });

  it('calls cutBySectionPlane then projectSectionView then writes store atomically (no bus.execute)', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');
    const { projectSectionView } = await import('../projectSectionView');

    await regenerateSectionView(SECTION_VIEW_FULL, 'sheet-1', fakeBus as never);

    expect(cutBySectionPlane).toHaveBeenCalledOnce();
    expect(cutBySectionPlane).toHaveBeenCalledWith(
      'part-uuid-1',
      SECTION_VIEW_FULL.plane,
      SECTION_VIEW_FULL.arrowDirection,
      undefined, // splitPlane absent for full mode
      undefined, // cutSide absent for full mode
    );
    expect(projectSectionView).toHaveBeenCalledOnce();
    // Section regenerate does NOT call bus.execute — it writes atomically via useAppStore.setState.
    expect(fakeBus.execute).not.toHaveBeenCalled();

    // Verify the store was updated atomically: projection + hatchSegments + inputFingerprint together.
    const liveDoc = useAppStore.getState().activeDocument;
    expect(liveDoc?.kind).toBe('drawing');
    const liveDrawing = (liveDoc as unknown as { kind: string; document: { sheets: Array<{ id: string; views: Array<{ id: string; projection?: unknown; hatchSegments?: unknown[]; inputFingerprint?: string }> }> } }).document;
    const updatedView = liveDrawing.sheets[0]!.views.find((v) => v.id === 'sec-1')!;
    expect(updatedView.inputFingerprint).toBe('new-source-fp');
    expect(Array.isArray(updatedView.hatchSegments)).toBe(true);
    expect((updatedView.hatchSegments as unknown[]).length).toBeGreaterThan(0);
    expect(updatedView.projection).toBeDefined();
  });
});

// ── Task 2: Half-section regression-coverage ─────────────────────────────

const SECTION_VIEW_HALF: SectionView = {
  id: 'sec-half',
  kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1,
  label: 'B',
  positionMm: { x: 250, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'half',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  splitPlane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  cutSide: 1,
  hatchSegments: [],
  fingerprint: 'old-half-fp',
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  },
  inputFingerprint: 'old-source-fp',
};

describe('regenerateSectionView — half mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [], featureTree: [], parameters: {} } as never,
      kernel: {} as never,
    });
  });

  it('passes splitPlane and cutSide to cutBySectionPlane for half mode', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');

    // Inject the half view into the store's drawing
    const doc = useAppStore.getState().activeDocument!.document as DrawingDocument;
    const withHalf: DrawingDocument = {
      ...doc,
      sheets: doc.sheets.map((s) => ({
        ...s,
        views: [...s.views, SECTION_VIEW_HALF],
      })),
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: withHalf }, activeDrawing: withHalf });

    await regenerateSectionView(SECTION_VIEW_HALF, 'sheet-1', fakeBus as never);

    expect(cutBySectionPlane).toHaveBeenCalledWith(
      'part-uuid-1',
      SECTION_VIEW_HALF.plane,
      SECTION_VIEW_HALF.arrowDirection,
      SECTION_VIEW_HALF.splitPlane,
      SECTION_VIEW_HALF.cutSide,
    );
  });
});

// ── Task 3: Cut failure regression-coverage ───────────────────────────────

describe('regenerateSectionView — cut failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithSection() },
      activeDrawing: makeDrawingWithSection(),
      activeDrawingSourcePartId: 'part-uuid-1',
      activeDrawingSourceFingerprint: 'new-source-fp',
      activePart: { id: 'part-uuid-1', materials: [], featureTree: [], parameters: {} } as never,
      kernel: {} as never,
    });
  });

  it('throws when cutBySectionPlane returns ok:false, store is NOT updated', async () => {
    const { cutBySectionPlane } = await import('../../kernel/cutBySectionPlane');
    (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: 'empty',
    });

    const fingerprintBefore = (useAppStore.getState().activeDocument as unknown as { kind: string; document: { sheets: Array<{ views: Array<{ id: string; inputFingerprint?: string }> }> } }).document.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_FULL.id)?.inputFingerprint;

    await expect(
      regenerateSectionView(SECTION_VIEW_FULL, 'sheet-1', fakeBus as never)
    ).rejects.toThrow('REGEN_SECTION cut failed');

    // Store not mutated — inputFingerprint unchanged.
    const fingerprintAfter = (useAppStore.getState().activeDocument as unknown as { kind: string; document: { sheets: Array<{ views: Array<{ id: string; inputFingerprint?: string }> }> } }).document.sheets[0]!.views.find((v) => v.id === SECTION_VIEW_FULL.id)?.inputFingerprint;
    expect(fingerprintAfter).toBe(fingerprintBefore);
    // bus never called (section skips it on the happy path too, but confirm no side effects).
    expect(fakeBus.execute).not.toHaveBeenCalled();
  });
});
