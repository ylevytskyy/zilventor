import { describe, it, expect } from 'vitest';
import type {
  DrawingDocument,
  DrawingSource,
  DrawingSheet,
  SheetSize,
  DrawingView,
  BaseView,
  ProjectedView,
  IsoView,
  ViewScale,
  DrawingDimension,
  PointRef,
  DrawingAnnotation,
  TitleBlockOverrides,
} from '../types';
import { ISO_SIZES_MM } from '../types';

describe('drawing/types — discriminator round-trips', () => {
  it('ISO_SIZES_MM has correct A3 dimensions', () => {
    expect(ISO_SIZES_MM.A3).toEqual({ w: 420, h: 297 });
  });

  it('ISO_SIZES_MM has all five sizes', () => {
    expect(Object.keys(ISO_SIZES_MM).sort()).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
  });

  it('BaseView kind discriminator survives JSON round-trip', () => {
    const view: BaseView = {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 10, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: true,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as BaseView;
    expect(parsed.kind).toBe('base');
    expect(parsed.orientation).toBe('front');
    expect(parsed.scale).toEqual({ numerator: 1, denominator: 1 });
  });

  it('ProjectedView kind discriminator survives JSON round-trip', () => {
    const view: ProjectedView = {
      id: 'v2',
      kind: 'projected',
      positionMm: { x: 150, y: 20 },
      baseViewId: 'v1',
      direction: 'right',
      scale: { numerator: 1, denominator: 2 },
      showHidden: false,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as ProjectedView;
    expect(parsed.kind).toBe('projected');
    expect(parsed.direction).toBe('right');
  });

  it('IsoView kind discriminator survives JSON round-trip', () => {
    const view: IsoView = {
      id: 'v3',
      kind: 'iso',
      positionMm: { x: 300, y: 20 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    const parsed = JSON.parse(JSON.stringify(view)) as IsoView;
    expect(parsed.kind).toBe('iso');
    expect(parsed.corner).toBe('NE');
  });

  it('SheetSize iso kind survives JSON round-trip', () => {
    const size: SheetSize = { kind: 'iso', size: 'A3' };
    const parsed = JSON.parse(JSON.stringify(size)) as SheetSize;
    expect(parsed.kind).toBe('iso');
    if (parsed.kind === 'iso') expect(parsed.size).toBe('A3');
  });

  it('SheetSize custom kind survives JSON round-trip', () => {
    const size: SheetSize = { kind: 'custom', widthMm: 500, heightMm: 350 };
    const parsed = JSON.parse(JSON.stringify(size)) as SheetSize;
    expect(parsed.kind).toBe('custom');
    if (parsed.kind === 'custom') {
      expect(parsed.widthMm).toBe(500);
      expect(parsed.heightMm).toBe(350);
    }
  });

  it('DrawingDimension linear-h kind survives JSON round-trip', () => {
    const dim: DrawingDimension = {
      id: 'd1',
      kind: 'linear-h',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 8,
    };
    const parsed = JSON.parse(JSON.stringify(dim)) as DrawingDimension;
    expect(parsed.kind).toBe('linear-h');
  });

  it('DrawingAnnotation balloon kind survives JSON round-trip', () => {
    const ann: DrawingAnnotation = {
      id: 'a1',
      kind: 'balloon',
      viewId: 'v1',
      targetMm: { x: 50, y: 60 },
      textPosMm: { x: 70, y: 80 },
      itemNumber: 3,
    };
    const parsed = JSON.parse(JSON.stringify(ann)) as DrawingAnnotation;
    expect(parsed.kind).toBe('balloon');
    if (parsed.kind === 'balloon') expect(parsed.itemNumber).toBe(3);
  });

  it('DrawingDocument shape assembles without TS errors', () => {
    const doc: DrawingDocument = {
      id: 'draw-1',
      name: 'Cabinet — Drawing',
      units: 'mm',
      source: { partPath: 'parts/cabinet1.zipt', sourceKind: 'part' },
      properties: {},
      sheets: [
        {
          id: 's1',
          name: 'Sheet 1',
          size: { kind: 'iso', size: 'A3' },
          orientation: 'landscape',
          views: [],
          dimensions: [],
          annotations: [],
          titleBlock: {},
        },
      ],
      activeSheetId: 's1',
    };
    expect(doc.units).toBe('mm');
    expect(doc.sheets).toHaveLength(1);
  });
});
