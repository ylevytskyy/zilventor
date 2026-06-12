// packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteViewCommand } from '../DeleteViewCommand';
import type { DrawingDocument, BaseView, ProjectedView, IsoView, DrawingDimension, SectionView, DetailView, PartsListAnnotation, DrawingAnnotation } from '@zilventor/shared';

vi.mock('../../drawing/sectionCache', () => ({
  sectionCache: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

import { sectionCache } from '../../drawing/sectionCache';

const BASE: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 100, y: 100 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};
const PROJ: ProjectedView = {
  id: 'proj-1', kind: 'projected',
  positionMm: { x: 200, y: 100 },
  baseViewId: 'base-1',
  direction: 'right',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};
const ISO: BaseView = {
  id: 'iso-standalone', kind: 'base',
  positionMm: { x: 300, y: 100 },
  orientation: 'top',
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
};
const DIM_BASE: DrawingDimension = {
  id: 'dim-1', kind: 'linear-h', viewId: 'base-1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
  offsetMm: 10,
};
const DIM_PROJ: DrawingDimension = {
  id: 'dim-2', kind: 'linear-v', viewId: 'proj-1',
  from: { kind: 'edge-endpoint', edgeId: 'e3', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e4', end: 'end' },
  offsetMm: 8,
};
const DIM_ISO: DrawingDimension = {
  id: 'dim-iso', kind: 'linear-h', viewId: 'iso-standalone',
  from: { kind: 'edge-endpoint', edgeId: 'e5', end: 'start' },
  to: { kind: 'edge-endpoint', edgeId: 'e6', end: 'end' },
  offsetMm: 5,
};

function makeDrawingWithCascade(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, PROJ, ISO],
      dimensions: [DIM_BASE, DIM_PROJ, DIM_ISO],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('DeleteViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithCascade() } });
  });

  it('deleting a non-base view removes only that view, not its siblings', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'iso-standalone' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views.find(v => v.id === 'iso-standalone')).toBeUndefined();
    // dim-iso should also be removed
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeUndefined();
  });

  it('cascade: deleting a base view removes it + projected children + all their dimensions', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const sheet = doc.sheets[0]!;

    // Only iso-standalone should remain
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views[0]!.id).toBe('iso-standalone');

    // dim-1 (base-1's dim) and dim-2 (proj-1's dim) gone; dim-iso stays
    expect(sheet.dimensions).toHaveLength(1);
    expect(sheet.dimensions[0]!.id).toBe('dim-iso');
  });

  it('cascade revert: Ctrl-Z restores base view + projected child + both dimensions in original order', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const sheet = doc.sheets[0]!;

    expect(sheet.views).toHaveLength(3);
    expect(sheet.views[0]!.id).toBe('base-1');
    expect(sheet.views[1]!.id).toBe('proj-1');
    expect(sheet.views[2]!.id).toBe('iso-standalone');

    expect(sheet.dimensions).toHaveLength(3);
    expect(sheet.dimensions[0]!.id).toBe('dim-1');
    expect(sheet.dimensions[1]!.id).toBe('dim-2');
    expect(sheet.dimensions[2]!.id).toBe('dim-iso');
  });

  it('non-base view revert restores the view and its dimension', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'iso-standalone' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(3);
    expect(sheet.dimensions).toHaveLength(3);
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeDefined();
  });
});

const SECTION_A: SectionView = {
  id: 'sect-a', kind: 'section',
  parentViewId: 'base-1',
  sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
  arrowDirection: 1,
  label: 'A',
  positionMm: { x: 250, y: 100 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'full',
  hatchSegments: [],
  fingerprint: 'fp-sect-a',
};

function makeDrawingWithSection(): DrawingDocument {
  return {
    id: 'd2', name: 'D2', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-2', name: 'Sheet 2',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, SECTION_A, ISO],
      dimensions: [DIM_BASE],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-2',
  };
}

describe('DeleteViewCommand — section cascade (F20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithSection() } });
  });

  it('deleting a base view with a section child removes both views', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-2', viewId: 'base-1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views[0]!.id).toBe('iso-standalone');
    expect(sheet.views.find(v => v.id === 'sect-a')).toBeUndefined();
  });

  it('deleting a base view with a section child calls sectionCache.delete for the section fingerprint', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-2', viewId: 'base-1' });
    await cmd.apply();
    expect(sectionCache.delete).toHaveBeenCalledWith('fp-sect-a');
  });

  it('revert after base+section cascade restores both views', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-2', viewId: 'base-1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(3);
    expect(sheet.views.find(v => v.id === 'sect-a')).toBeDefined();
    expect(sheet.views.find(v => v.id === 'base-1')).toBeDefined();
  });

  it('deleting a base view with no section children removes only the base', async () => {
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: makeDrawingWithCascade(),
      },
    });
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();
    expect(sectionCache.delete).not.toHaveBeenCalled();
  });
});

// ── Detail cascade fixtures ───────────────────────────────────────────────

const BASE_FOR_DETAIL: BaseView = {
  id: 'base-d1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline' as const, points: [[0, 0], [100, 0]] as [number, number][], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
  },
  inputFingerprint: 'parent-fp',
};

const DETAIL_A: DetailView = {
  id: 'detail-a', kind: 'detail',
  parentViewId: 'base-d1',
  regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-e1', kind: 'outline' as const, points: [[2, 1], [8, 1]] as [number, number][], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
  },
  inputFingerprint: 'detail-a-fp',
};

function makeDrawingWithDetail(): DrawingDocument {
  return {
    id: 'd-detail', name: 'D-Detail', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-d', name: 'Sheet D',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_FOR_DETAIL, DETAIL_A],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-d',
  };
}

describe('DeleteViewCommand — detail cascade (Drawing F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() } });
  });

  it('deleting a base view with one detail child removes both views', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'base-d1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(0);
    expect(sheet.views.find(v => v.id === 'detail-a')).toBeUndefined();
    expect(sheet.views.find(v => v.id === 'base-d1')).toBeUndefined();
  });

  it('revert after base+detail cascade restores both views in original order', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'base-d1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views[0]!.id).toBe('base-d1');
    expect(sheet.views[1]!.id).toBe('detail-a');
  });

  it('deleting only the detail view (not parent) removes only the detail', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-d', viewId: 'detail-a' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views[0]!.id).toBe('base-d1');
  });

  it('deleting parent with 2 detail + 1 section children removes all 4 views', async () => {
    const detail_b: DetailView = {
      id: 'detail-b', kind: 'detail',
      parentViewId: 'base-d1',
      regionParent: { kind: 'circle', center: { x: 30, y: 20 }, radiusMm: 8 },
      label: 'B',
      positionMm: { x: 300, y: 200 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'detail-b-fp',
    };
    const section_c = {
      id: 'sect-c', kind: 'section' as const,
      parentViewId: 'base-d1',
      sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 100, y: 30 } },
      arrowDirection: 1 as const,
      label: 'C',
      positionMm: { x: 400, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const,
      mode: 'full' as const,
      hatchSegments: [],
      fingerprint: 'fp-sect-c',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    // Sheet has: base-d1, detail-a, detail-b, sect-c
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-mixed', name: 'D-Mixed', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-m', name: 'Sheet M',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, DETAIL_A, detail_b, section_c],
            dimensions: [],
            dimensionGroups: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-m',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-m', viewId: 'base-d1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(0);
  });

  it('revert restores all 4 views in original order after mixed cascade delete', async () => {
    const detail_b: DetailView = {
      id: 'detail-b', kind: 'detail',
      parentViewId: 'base-d1',
      regionParent: { kind: 'circle', center: { x: 30, y: 20 }, radiusMm: 8 },
      label: 'B',
      positionMm: { x: 300, y: 200 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'detail-b-fp',
    };
    const section_c = {
      id: 'sect-c', kind: 'section' as const,
      parentViewId: 'base-d1',
      sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 100, y: 30 } },
      arrowDirection: 1 as const,
      label: 'C',
      positionMm: { x: 400, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const,
      mode: 'full' as const,
      hatchSegments: [],
      fingerprint: 'fp-sect-c',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-mixed2', name: 'D-Mixed2', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-m2', name: 'Sheet M2',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, DETAIL_A, detail_b, section_c],
            dimensions: [],
            dimensionGroups: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-m2',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-m2', viewId: 'base-d1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(4);
    expect(sheet.views[0]!.id).toBe('base-d1');
    expect(sheet.views[1]!.id).toBe('detail-a');
    expect(sheet.views[2]!.id).toBe('detail-b');
    expect(sheet.views[3]!.id).toBe('sect-c');
  });

  it('cascades when deleting a projected view that has a detail child', async () => {
    const projParent: ProjectedView = {
      id: 'proj-p1', kind: 'projected',
      positionMm: { x: 200, y: 50 },
      baseViewId: 'base-d1',
      direction: 'right',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      projection: {
        visibleEdges: [{ id: 'p1', kind: 'outline' as const, points: [[0, 0], [50, 0]] as [number, number][], sourceFaceIds: [] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
      },
      inputFingerprint: 'proj-fp',
    };
    const detailFromProj: DetailView = {
      ...DETAIL_A,
      id: 'detail-from-proj',
      parentViewId: 'proj-p1',
      label: 'P',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-proj', name: 'D-Proj', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-p', name: 'Sheet P',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, projParent, detailFromProj],
            dimensions: [],
            dimensionGroups: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-p',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-p', viewId: 'proj-p1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views.map(v => v.id)).toEqual(['base-d1']);
  });

  it('cascades when deleting an iso view that has a detail child', async () => {
    const isoParent: IsoView = {
      id: 'iso-i1', kind: 'iso',
      positionMm: { x: 350, y: 50 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      projection: {
        visibleEdges: [{ id: 'i1', kind: 'outline' as const, points: [[0, 0], [40, 30]] as [number, number][], sourceFaceIds: [] }],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
      },
      inputFingerprint: 'iso-fp',
    };
    const detailFromIso: DetailView = {
      ...DETAIL_A,
      id: 'detail-from-iso',
      parentViewId: 'iso-i1',
      label: 'I',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-iso', name: 'D-Iso', units: 'mm',
          source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-i', name: 'Sheet I',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [BASE_FOR_DETAIL, isoParent, detailFromIso],
            dimensions: [],
            dimensionGroups: [],
            annotations: [],
            titleBlock: {},
          }],
          activeSheetId: 'sheet-i',
        },
      },
    });

    const cmd = new DeleteViewCommand({ sheetId: 'sheet-i', viewId: 'iso-i1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views.map(v => v.id)).toEqual(['base-d1']);
  });
});

// ── PartsListAnnotation (sheet-level, no viewId) regression ──────────────

const PARTS_LIST_ANN: PartsListAnnotation = {
  kind: 'partsList',
  id: 'pl-ann-1',
  positionMm: { x: 10, y: 20 },
  rows: [
    { item: 1, qty: 2, partName: 'Side Panel', material: 'MDF 18mm', dimensions: '700×300×18', edgeBands: 'ABS' },
  ],
};

const VIEW_BOUND_ANN: DrawingAnnotation = {
  id: 'ann-view-bound',
  kind: 'balloon',
  viewId: 'base-1',
  targetMm: { x: 50, y: 50 },
  textPosMm: { x: 80, y: 40 },
  itemNumber: 1,
};

function makeDrawingWithPartsList(): DrawingDocument {
  return {
    id: 'd-pl', name: 'D-PL', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-pl', name: 'Sheet PL',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, ISO],
      dimensions: [],
      dimensionGroups: [],
      annotations: [PARTS_LIST_ANN as DrawingAnnotation, VIEW_BOUND_ANN],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-pl',
  };
}

describe('DeleteViewCommand — partsList annotation (sheet-level, no viewId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithPartsList() } });
  });

  it('deleting a view does not throw and partsList annotation survives', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-pl', viewId: 'base-1' });
    await expect(cmd.apply()).resolves.not.toThrow();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    // partsList has no viewId — it must survive a view deletion
    const survived = sheet.annotations.find(a => a.id === 'pl-ann-1');
    expect(survived).toBeDefined();
    expect(survived?.kind).toBe('partsList');
    // view-bound balloon referencing deleted view is gone
    expect(sheet.annotations.find(a => a.id === 'ann-view-bound')).toBeUndefined();
  });
});

// ── Half-section cascade regression (Drawing F1.1) ───────────────────────

const HALF_SV: SectionView = {
  id: 'section-half-1', kind: 'section', parentViewId: 'base-1',
  sectionLine: { p0: { x: 10, y: 50 }, p1: { x: 190, y: 50 } },
  arrowDirection: 1, label: 'A', positionMm: { x: 10, y: 150 },
  scale: { numerator: 1, denominator: 1 }, showHidden: false,
  mode: 'half', cutSide: 1,
  splitPlane: { origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
  hatchSegments: [], fingerprint: 'fp-half',
};

function makeDrawingWithHalfSection(): DrawingDocument {
  return {
    id: 'd-half', name: 'D-Half', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-half', name: 'Sheet Half',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, HALF_SV],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-half',
  };
}

describe('DeleteViewCommand — mode=half cascade (Drawing F1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithHalfSection() } });
  });

  it('deleting base view also removes a mode=half SectionView that references it', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-half', viewId: 'base-1' });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(0);
    expect(sheet.views.find(v => v.id === 'section-half-1')).toBeUndefined();
    expect(sheet.views.find(v => v.id === 'base-1')).toBeUndefined();
  });

  it('deleting base view with mode=half child calls sectionCache.delete for fingerprint', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-half', viewId: 'base-1' });
    await cmd.apply();
    expect(sectionCache.delete).toHaveBeenCalledWith('fp-half');
  });

  it('revert after base+mode=half cascade restores both views', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-half', viewId: 'base-1' });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const sheet = _ad.document.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views.find(v => v.id === 'section-half-1')).toBeDefined();
    expect(sheet.views.find(v => v.id === 'base-1')).toBeDefined();
  });
});
