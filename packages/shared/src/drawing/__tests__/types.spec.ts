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
  SectionView,
  HatchSegment,
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
          dimensionGroups: [],
        },
      ],
      activeSheetId: 's1',
    };
    expect(doc.units).toBe('mm');
    expect(doc.sheets).toHaveLength(1);
  });

  // --- Section-view additions (Drawing F1) ---

  it('SectionView kind discriminator survives JSON round-trip', () => {
    const sv: SectionView = {
      id: 'sv1',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 10, y: 50 }, p1: { x: 190, y: 50 } },
      arrowDirection: 1,
      label: 'A',
      positionMm: { x: 10, y: 120 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'full',
      hatchSegments: [],
      fingerprint: '',
    };
    const parsed = JSON.parse(JSON.stringify(sv)) as SectionView;
    expect(parsed.kind).toBe('section');
    expect(parsed.parentViewId).toBe('v1');
    expect(parsed.arrowDirection).toBe(1);
  });

  it('HatchSegment carries p0, p1, materialId', () => {
    const seg: HatchSegment = {
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 0 },
      materialId: 'm1',
    };
    expect(seg.materialId).toBe('m1');
  });

  it('DrawingView union exhaustiveness — section variant reachable', () => {
    // Compile-time check: this switch must handle all DrawingView kinds.
    // If 'section' is missing from the union the branch is dead-code and TS
    // will warn; if SectionView is absent from DrawingView it is a type error.
    function label(v: DrawingView): string {
      switch (v.kind) {
        case 'base':      return 'base';
        case 'projected': return 'projected';
        case 'iso':       return 'iso';
        case 'section':   return 'section';
        case 'detail':    return 'detail';
        default: {
          const _: never = v;
          return _;
        }
      }
    }
    const sv: DrawingView = {
      id: 'sv2', kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      arrowDirection: -1, label: 'B',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 2 },
      showHidden: false, mode: 'full', hatchSegments: [], fingerprint: '',
    };
    expect(label(sv)).toBe('section');
  });
});

// --- Half-section additions (Drawing F1.1) ---

describe('SectionView — half-section mode fields (F1.1)', () => {
  it('SectionView with mode: full has no cutSide or splitPlane', () => {
    const sv: SectionView = {
      id: 'sv-full',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      arrowDirection: 1,
      label: 'A',
      positionMm: { x: 10, y: 130 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'full',
      hatchSegments: [],
      fingerprint: '',
    };
    expect(sv.mode).toBe('full');
    expect(sv.cutSide).toBeUndefined();
    expect(sv.splitPlane).toBeUndefined();
  });

  it('SectionView with mode: half carries cutSide and splitPlane', () => {
    const sv: SectionView = {
      id: 'sv-half',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      arrowDirection: 1,
      label: 'B',
      positionMm: { x: 10, y: 200 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'half',
      cutSide: 1,
      splitPlane: {
        origin: { x: 100, y: 0, z: 0 },
        normal: { x: 1, y: 0, z: 0 },
      },
      hatchSegments: [],
      fingerprint: '',
    };
    expect(sv.mode).toBe('half');
    expect(sv.cutSide).toBe(1);
    expect(sv.splitPlane).toBeDefined();
    expect(sv.splitPlane!.normal.x).toBe(1);
  });

  it('SectionView half-section survives JSON round-trip with all new fields intact', () => {
    const sv: SectionView = {
      id: 'sv-rt',
      kind: 'section',
      parentViewId: 'v2',
      sectionLine: { p0: { x: 10, y: 40 }, p1: { x: 190, y: 40 } },
      arrowDirection: -1,
      label: 'C',
      positionMm: { x: 10, y: 280 },
      scale: { numerator: 1, denominator: 2 },
      showHidden: false,
      mode: 'half',
      cutSide: -1,
      splitPlane: {
        origin: { x: 50, y: 30, z: 20 },
        normal: { x: 0, y: 1, z: 0 },
      },
      hatchSegments: [],
      fingerprint: 'abc123',
    };
    const parsed = JSON.parse(JSON.stringify(sv)) as SectionView;
    expect(parsed.mode).toBe('half');
    expect(parsed.cutSide).toBe(-1);
    expect(parsed.splitPlane!.origin.y).toBe(30);
    expect(parsed.splitPlane!.normal.y).toBe(1);
  });

  it('α-invariant: mode full leaves cutSide and splitPlane undefined after round-trip', () => {
    const sv: SectionView = {
      id: 'sv-alpha',
      kind: 'section',
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } },
      arrowDirection: 1,
      label: 'D',
      positionMm: { x: 0, y: 150 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      mode: 'full',
      hatchSegments: [],
      fingerprint: '',
    };
    const parsed = JSON.parse(JSON.stringify(sv)) as SectionView;
    // α-invariant: mode === 'full' => cutSide and splitPlane must be absent
    expect(parsed.mode).toBe('full');
    expect(parsed.cutSide).toBeUndefined();
    expect(parsed.splitPlane).toBeUndefined();
  });
});

// --- Auto-dim additions (Drawing F4) ---

describe('DrawingDimension — F4 sourceParameterName + textOverride fields', () => {
  it('linear-h with sourceParameterName and textOverride accepted by TypeScript', () => {
    const dim: DrawingDimension = {
      id: 'd-auto-1',
      kind: 'linear-h',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
      offsetMm: 8,
      sourceParameterName: 'width',
      textOverride: 'WIDTH ±0.5',
    };
    expect(dim.sourceParameterName).toBe('width');
    expect(dim.textOverride).toBe('WIDTH ±0.5');
  });

  it('manual linear-h without sourceParameterName or textOverride still accepted', () => {
    const dim: DrawingDimension = {
      id: 'd-manual-1',
      kind: 'linear-h',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 10,
    };
    expect(dim.sourceParameterName).toBeUndefined();
    expect(dim.textOverride).toBeUndefined();
  });

  it('linear-v with sourceParameterName only accepted', () => {
    const dim: DrawingDimension = {
      id: 'd-auto-2',
      kind: 'linear-v',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 5,
      sourceParameterName: 'height',
    };
    expect(dim.sourceParameterName).toBe('height');
    expect(dim.textOverride).toBeUndefined();
  });

  it('aligned with textOverride only accepted', () => {
    const dim: DrawingDimension = {
      id: 'd-auto-3',
      kind: 'aligned',
      viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 6,
      textOverride: 'DIAG',
    };
    expect(dim.textOverride).toBe('DIAG');
    expect(dim.sourceParameterName).toBeUndefined();
  });

  it('radial dim does NOT have sourceParameterName (radial unchanged in v1)', () => {
    const dim: DrawingDimension = {
      id: 'd-radial-1',
      kind: 'radial',
      viewId: 'v1',
      edgeId: 'e1',
      offsetMm: 10,
      angleDeg: 45,
    };
    // Runtime check: field absent
    expect((dim as Record<string, unknown>)['sourceParameterName']).toBeUndefined();
  });
});
