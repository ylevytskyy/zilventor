// packages/app/src/drawing/__tests__/DrawingCanvas.underlay.spec.tsx
// F3 canvas: DrawingCanvas renders <g data-underlay> before views for a sheet with underlay
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DrawingCanvas } from '../DrawingCanvas';
import { useAppStore } from '../../store/useAppStore';
import { useToolModeStore } from '../toolMode';
import type { DrawingDocument, DrawingSheet, DxfUnderlay } from '@zilventor/shared';

// Stub out commands that are imported at module level (avoid side effects)
vi.mock('../../commands/AddBreakCommand', () => ({
  AddBreakCommand: vi.fn().mockImplementation((p) => ({ name: 'AddBreakCommand', payload: p })),
}));
vi.mock('../../commands/AddDrawingDimensionCommand', () => ({
  AddDrawingDimensionCommand: vi.fn().mockImplementation((p) => ({ name: 'AddDrawingDimensionCommand', payload: p })),
}));
vi.mock('../../commands/AddSectionViewCommand', () => ({
  AddSectionViewCommand: vi.fn().mockImplementation((p) => ({ name: 'AddSectionViewCommand', payload: p })),
}));
vi.mock('../../commands/AddDetailViewCommand', () => ({
  AddDetailViewCommand: vi.fn().mockImplementation((p) => ({ name: 'AddDetailViewCommand', payload: p })),
}));

function makeUnderlaySheet(): DrawingSheet {
  const underlay: DxfUnderlay = {
    name: 'test.dxf',
    entities: [
      { kind: 'line',     x1: 0,  y1: 0,  x2: 50,  y2: 0 },
      { kind: 'circle',   cx: 25, cy: 25, r: 10 },
      { kind: 'arc',      cx: 0,  cy: 0,  r: 10,   startAngle: 0, endAngle: 90 },
      { kind: 'text',     x: 5,   y: 5,   height: 4, value: 'UnderlayText', rotation: 0 },
      { kind: 'polyline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]>, closed: false },
    ],
  };
  return {
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [
      {
        id: 'v1',
        kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [10, 0]] as ReadonlyArray<readonly [number, number]> }],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        },
      },
    ],
    dimensions: [],
    annotations: [],
    titleBlock: {},
    dimensionGroups: [],
    underlay,
  };
}

function makeDrawing(sheet: DrawingSheet): DrawingDocument {
  return {
    id: 'd1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sheet],
    activeSheetId: sheet.id,
  };
}

describe('DrawingCanvas — DXF underlay (F3 canvas)', () => {
  beforeEach(() => {
    useToolModeStore.setState({ mode: 'idle' });
    const sheet = makeUnderlaySheet();
    const drawing = makeDrawing(sheet);
    useAppStore.setState({
      activeDrawing: drawing,
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
  });

  it('renders a <g data-underlay> element', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]');
    expect(underlayGroup).not.toBeNull();
  });

  it('underlay group has pointerEvents:none (non-interactive)', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]') as HTMLElement | null;
    expect(underlayGroup).not.toBeNull();
    // React renders pointer-events as a style or SVG attribute
    const peAttr = underlayGroup?.getAttribute('pointer-events');
    const peStyle = (underlayGroup as SVGElement | null)?.style?.pointerEvents;
    const hasNone = peAttr === 'none' || peStyle === 'none';
    expect(hasNone).toBe(true);
  });

  it('underlay group appears before the first view group in DOM order', () => {
    render(<DrawingCanvas />);
    const svg = document.querySelector('svg')!;
    const allElements = Array.from(svg.querySelectorAll('[data-underlay], [data-view-id]'));
    // data-underlay should be the first element encountered
    expect(allElements.length).toBeGreaterThanOrEqual(2);
    expect(allElements[0]?.hasAttribute('data-underlay')).toBe(true);
  });

  it('underlay group contains a line element', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]')!;
    expect(underlayGroup.querySelector('line')).not.toBeNull();
  });

  it('underlay group contains a circle element', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]')!;
    expect(underlayGroup.querySelector('circle')).not.toBeNull();
  });

  it('underlay group contains a path element (arc)', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]')!;
    expect(underlayGroup.querySelector('path')).not.toBeNull();
  });

  it('underlay group contains a text element', () => {
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]')!;
    const textEl = underlayGroup.querySelector('text');
    expect(textEl).not.toBeNull();
    expect(textEl?.textContent).toContain('UnderlayText');
  });

  it('underlay group carries a transform with scale(1,-1) for y-flip when offsetMm is set', () => {
    // Override store with underlay that has offsetMm
    const sheetWithOffset: DrawingSheet = {
      id: 's-off',
      name: 'Sheet with offset',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
      underlay: {
        name: 'offset-test.dxf',
        entities: [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }],
        offsetMm: { x: 5, y: -10 },
      },
    };
    useAppStore.setState({
      activeDrawing: {
        id: 'd-off',
        name: 'Offset Drawing',
        units: 'mm',
        source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [sheetWithOffset],
        activeSheetId: sheetWithOffset.id,
      },
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
    render(<DrawingCanvas />);
    const underlayGroup = document.querySelector('[data-underlay]') as SVGGElement | null;
    expect(underlayGroup).not.toBeNull();
    const transform = underlayGroup?.getAttribute('transform') ?? '';
    expect(transform).toContain('scale(1,-1)');
  });

  it('sheet without underlay renders no [data-underlay] group', () => {
    useAppStore.setState({
      activeDrawing: {
        id: 'd2',
        name: 'No underlay',
        units: 'mm',
        source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [{
          id: 's2',
          name: 'Sheet',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape' as const,
          views: [],
          dimensions: [],
          annotations: [],
          titleBlock: {},
          dimensionGroups: [],
          // no underlay field
        }],
        activeSheetId: 's2',
      },
      bus: { execute: vi.fn().mockResolvedValue(undefined) },
    } as never);
    render(<DrawingCanvas />);
    expect(document.querySelector('[data-underlay]')).toBeNull();
  });
});
