// packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteViewCommand } from '../DeleteViewCommand';
import type { DrawingDocument, BaseView, ProjectedView, DrawingDimension, SectionView } from '@zilventor/shared';

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
