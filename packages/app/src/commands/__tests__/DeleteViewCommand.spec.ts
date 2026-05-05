// packages/app/src/commands/__tests__/DeleteViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteViewCommand } from '../DeleteViewCommand';
import type { DrawingDocument, BaseView, ProjectedView, DrawingDimension } from '@zilventor/shared';

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
    // TODO(phase-7): drop cast after activeDocument union widening
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithCascade() } } as never);
  });

  it('deleting a non-base view removes only that view, not its siblings', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'iso-standalone' });
    await cmd.apply();

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(2);
    expect(sheet.views.find(v => v.id === 'iso-standalone')).toBeUndefined();
    // dim-iso should also be removed
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeUndefined();
  });

  it('cascade: deleting a base view removes it + projected children + all their dimensions', async () => {
    const cmd = new DeleteViewCommand({ sheetId: 'sheet-1', viewId: 'base-1' });
    await cmd.apply();

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
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

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
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

    // TODO(phase-7): drop cast after activeDocument union widening
    const doc = (useAppStore.getState().activeDocument as unknown as { kind: 'drawing'; document: DrawingDocument }).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(3);
    expect(sheet.dimensions).toHaveLength(3);
    expect(sheet.dimensions.find(d => d.id === 'dim-iso')).toBeDefined();
  });
});
