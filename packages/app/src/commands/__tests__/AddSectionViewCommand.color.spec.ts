// packages/app/src/commands/__tests__/AddSectionViewCommand.color.spec.ts
//
// Task 5 — verify the colorForFace closure is built correctly and passed as the
// 7th arg to projectSectionView in AddSectionViewCommand (full/half/stepped).
//
// Strategy: mock projectSectionView to CAPTURE and INVOKE the colorForFace arg
// with a test partId, producing colored hatchSegments. This drives the REAL command
// path without any stub injection — the closure is built by the command itself.
//
// Why at the command level (not the projectSectionView call level):
//   - Proves the real closure is constructed from the right store state.
//   - Proves the 7th arg is wired, not just that projectSectionView accepts it.
//   - Mirrors the existing AddSectionViewCommand.test.ts pattern (all other tests
//     drive apply() end-to-end and assert on the resulting SectionView shape).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddSectionViewCommand } from '../AddSectionViewCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, SectionView } from '@zilventor/shared';

// ── Kernel / cache mocks ──────────────────────────────────────────────────
vi.mock('../../kernel/cutBySectionPlane', () => ({
  cutBySectionPlane: vi.fn(),
  cutAssemblyBySectionPlane: vi.fn(),
  cutByStepSegments: vi.fn(),
  cutAssemblyByStepSegments: vi.fn(),
  cutAssemblyComponentsBySectionPlane: vi.fn(),
  cutAssemblyComponentsByStepSegments: vi.fn(),
}));

vi.mock('../../drawing/sectionCache', () => ({
  sectionCache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── projectSectionView mock: captures colorForFace + invokes it ───────────
// The mock receives the colorForFace closure (7th arg) and calls it with a
// known partId so the resulting hatchSegments carry color. This proves the
// closure is wired correctly through the real command path.
vi.mock('../../drawing/projectSectionView', () => ({
  projectSectionView: vi.fn().mockImplementation(
    (
      _source: unknown,
      _faceTags: unknown,
      _scale: unknown,
      _hatchLookup: unknown,
      _sectionViewMatrix: unknown,
      _view: unknown,
      colorForFace?: (partId: string) => string,
    ) => {
      // Simulate two cut faces: one with partId '' (part path), one with 'A' (assembly path).
      // The closure will be called with these partIds and produce colored segments.
      const partIds = ['', 'A', 'B'];
      const hatchSegments = partIds.map((pid) => ({
        p0: { x: 0, y: 0 },
        p1: { x: 10, y: 0 },
        materialId: 'mat-1',
        color: colorForFace ? colorForFace(pid) : undefined,
      }));
      return { edges: [], hatchSegments, fingerprint: 'fp-color-mock' };
    },
  ),
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
  deriveStepPlanes: vi.fn().mockReturnValue([
    { origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    { origin: { x: 60, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  ]),
  validateSteppedInvariant: vi.fn(),
}));

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    resolveSectionSource: vi.fn().mockReturnValue({ kind: 'part', id: 'src-fp' }),
  };
});

import { cutBySectionPlane, cutAssemblyComponentsBySectionPlane } from '../../kernel/cutBySectionPlane';
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
  (sectionCache.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (cutBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    compound: {},
    faceTags: new Map(),
  });
  (cutAssemblyComponentsBySectionPlane as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    compound: {},
    faceTags: new Map(),
  });
});

// ── Test 1: PART path — closure uses activePart.materials[0].color ────────
describe('AddSectionViewCommand.color — PART path (Task 5)', () => {
  it('hatchSegments all have color === activePart.materials[0].color when no componentColors', async () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawing() },
      activePart: {
        id: 'part-uuid-1',
        materials: [{ id: 'm1', name: 'Pine', defaultThickness: 18, color: '#336699' }],
        featureTree: [],
        parameters: {},
      } as never,
      activeAssembly: null,
      activeDrawingSourceComponentColors: null,
    } as never);

    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
    const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
    expect(sv).toBeDefined();
    expect(sv.hatchSegments.length).toBeGreaterThan(0);
    // Every segment should have color from the part material (closure ?? chain hits activePart.materials[0].color).
    // partId '' → map miss (componentColors null) → activePart.materials[0].color = '#336699'.
    expect(sv.hatchSegments.every((s) => s.color === '#336699')).toBe(true);
  });
});

// ── Test 2: ASSEMBLY path (TEETH) — ≥2 distinct colors from componentColors ─
describe('AddSectionViewCommand.color — ASSEMBLY path teeth (Task 5)', () => {
  it('hatchSegments contain ≥2 distinct colors including #aa0000 and #0000bb from componentColors', async () => {
    // Override resolveSectionSource to return assembly for this test.
    const { resolveSectionSource } = await import('@zilventor/shared');
    (resolveSectionSource as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'assembly',
      id: 'assemblies/asm1.ziasm',
    });

    const asmDrawing: DrawingDocument = {
      ...makeDrawing(),
      source: { partPath: 'assemblies/asm1.ziasm', sourceKind: 'assembly' },
    };

    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: asmDrawing },
      activePart: null,
      activeAssembly: { id: 'asm-uuid-1', materials: [], components: [] } as never,
      activeDrawingSourceComponents: [
        { partId: 'A', pose: { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] } },
        { partId: 'B', pose: { translation: { x: 50, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] } },
      ],
      // componentColors map — A → red, B → blue
      activeDrawingSourceComponentColors: { A: '#aa0000', B: '#0000bb' },
    } as never);

    const cmd = new AddSectionViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find((s) => s.id === 's1')!;
    const sv = sheet.views.find((v) => v.kind === 'section') as SectionView;
    expect(sv).toBeDefined();

    const colors = sv.hatchSegments.map((s) => s.color);
    // TEETH: must have ≥2 distinct colors (NOT a count assertion — a count is
    // identical whether colorForFace is wired or not).
    const distinctColors = new Set(colors);
    expect(distinctColors.size).toBeGreaterThanOrEqual(2);
    // The two assembly component colors must both appear.
    expect(distinctColors.has('#aa0000')).toBe(true);
    expect(distinctColors.has('#0000bb')).toBe(true);
  });
});
