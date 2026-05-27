import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingTab from '../DrawingTab';
import { useAppStore } from '../../../store/useAppStore';
import { useToolModeStore } from '../../../drawing/toolMode';
import type { DrawingDocument } from '@zilventor/shared';

const seedDrawing = (): DrawingDocument => ({
  id: 'dw1',
  name: 'Cabinet — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [
    {
      id: 'sh1',
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
  activeSheetId: 'sh1',
});

describe('DrawingTab — drawing active doc', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders 5 ribbon panels when a drawing document is active', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByText('Sheet')).toBeInTheDocument();
    expect(screen.getByText('Place Views')).toBeInTheDocument();
    expect(screen.getByText('Dimension')).toBeInTheDocument();
    expect(screen.getByText('Annotate')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('renders exactly 2 Sheet buttons, 3 Place Views buttons, 5 Dimension buttons, 4 Annotate buttons, 5 Export buttons', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    // Sheet panel: New Sheet + Sheet… (disabled follow-up)
    expect(screen.getByRole('button', { name: /new sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sheet…$/i })).toBeInTheDocument();
    // Place Views panel
    expect(screen.getByRole('button', { name: /base view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /projected view/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iso view/i })).toBeInTheDocument();
    // Dimension panel
    expect(screen.getByRole('button', { name: /linear \(h\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /linear \(v\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^aligned$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^radial$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^diametric$/i })).toBeInTheDocument();
    // Annotate panel
    expect(screen.getByRole('button', { name: /centerline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /center mark/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leader text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /balloon/i })).toBeInTheDocument();
    // Export panel
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export svg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export dxf$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export dxf \(1:1\)$/i })).toBeInTheDocument();
  });

  it('clicking Linear (H) calls setMode("addLinearH")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /linear \(h\)/i }));
    expect(useToolModeStore.getState().mode).toBe('addLinearH');
  });

  it('clicking Radial calls setMode("addRadial")', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^radial$/i }));
    expect(useToolModeStore.getState().mode).toBe('addRadial');
  });

  it('Balloon button is disabled for a part source drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() }); // sourceKind: 'part'
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).toBeDisabled();
  });

  it('Balloon button is enabled for an assembly source drawing', () => {
    const dwg: DrawingDocument = {
      ...seedDrawing(),
      source: { partPath: 'cabinets/c1.ziasm', sourceKind: 'assembly' },
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwg });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /balloon/i })).not.toBeDisabled();
  });

  it('Sheet… button is disabled with title indicating follow-up', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /^sheet…$/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/follow-up/i);
  });

  it('renders a disabled Export DXF button when no activePart/activeAssembly is set', () => {
    // activePart and activeAssembly are both null (default store state) — button must be disabled.
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /^export dxf$/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('renders a disabled Export DXF (1:1) button when no projected view exists', () => {
    // seedDrawing() has views: [] → hasProjectedView=false → button disabled.
    // Guards the `disabled={!hasProjectedView}` gate on the 1:1 export button.
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export dxf \(1:1\)$/i })).toBeDisabled();
  });

  it('enables export buttons from activeDrawingSourceDocument alone (drawing active, activePart null)', () => {
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDrawingSourceDocument: { id: 'p1', name: 'Widget', units: 'mm', parameters: {},
        featureTree: [], properties: {}, materials: [], hardware: [] },
    } as never);
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    for (const label of ['Export PDF', 'Export SVG', 'Export PNG', 'Export DXF']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
  });
});

describe('DrawingTab ribbon — Detail button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders a "Detail" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).toBeInTheDocument();
  });

  it('clicking Detail button calls enterDetailMode() — mode becomes detail', () => {
    // Need a drawing with a projected view to enable the Detail button
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^detail$/i }));
    expect(useToolModeStore.getState().mode).toBe('detail');
    expect(useToolModeStore.getState().detailState.stage).toBe('idle');
  });

  it('Detail button is disabled when no views have a projection', () => {
    // seedDrawing() has views: [] (no projection)
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).toBeDisabled();
  });

  it('Detail button is enabled when at least one view has a projection', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: {
                visibleEdges: [],
                hiddenEdges: [],
                bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 },
              },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^detail$/i })).not.toBeDisabled();
  });

  it('Detail button appears after Section button in DOM order', () => {
    render(<DrawingTab />);
    const buttons = Array.from(screen.getAllByRole('button'));
    const sectionIdx = buttons.findIndex((b) => /^section$/i.test(b.textContent ?? ''));
    const detailIdx  = buttons.findIndex((b) => /^detail$/i.test(b.textContent ?? ''));
    expect(sectionIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(sectionIdx);
  });
});

describe('DrawingTab ribbon — Section button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders a "Section" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^section$/i })).toBeInTheDocument();
  });

  it('clicking Section button calls enterSectionMode() — mode becomes section and stage idle', () => {
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /^section$/i }));
    const state = useToolModeStore.getState();
    expect(state.mode).toBe('section');
    expect(state.sectionState.stage).toBe('idle');
  });
});

describe('DrawingTab — Half Section ribbon button (HS-UI-2)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders "Half Section" button', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Half Section' })).toBeInTheDocument();
  });

  it('clicking "Half Section" sets sectionMode=half and mode=section', () => {
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Half Section' }));
    const s = useToolModeStore.getState();
    expect(s.sectionMode).toBe('half');
    expect(s.mode).toBe('section');
  });

  it('clicking "Section" sets sectionMode=full and mode=section', () => {
    render(<DrawingTab />);
    useToolModeStore.getState().setSectionMode('half');
    fireEvent.click(screen.getByRole('button', { name: 'Section' }));
    const s = useToolModeStore.getState();
    expect(s.sectionMode).toBe('full');
    expect(s.mode).toBe('section');
  });
});

describe('DrawingTab ribbon — Add Break button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders an "Add Break" button in the Place Views panel', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).toBeInTheDocument();
  });

  it('Add Break button is disabled when no breakable views have a projection', () => {
    // seedDrawing() has views: [] → no projection
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).toBeDisabled();
  });

  it('Add Break button is enabled when at least one breakable view has a projection', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: {
                visibleEdges: [],
                hiddenEdges: [],
                bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 },
              },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /add break/i })).not.toBeDisabled();
  });

  it('clicking Add Break button calls enterBreakMode()', () => {
    const dwgWithProjection: DrawingDocument = {
      ...seedDrawing(),
      sheets: [
        {
          ...seedDrawing().sheets[0]!,
          views: [
            {
              id: 'bv1', kind: 'base' as const,
              positionMm: { x: 20, y: 20 },
              scale: { numerator: 1, denominator: 1 },
              orientation: 'front' as const,
              showHidden: false,
              projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
              inputFingerprint: 'fp1',
            },
          ],
        },
      ],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: dwgWithProjection });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: /add break/i }));
    expect(useToolModeStore.getState().mode).toBe('break');
    expect(useToolModeStore.getState().breakState.stage).toBe('pickParent');
  });

  it('Add Break button appears after Detail button in DOM order', () => {
    render(<DrawingTab />);
    const buttons = Array.from(screen.getAllByRole('button'));
    const detailIdx = buttons.findIndex((b) => /^detail$/i.test(b.textContent ?? ''));
    const addBreakIdx = buttons.findIndex((b) => /add break/i.test(b.textContent ?? ''));
    expect(detailIdx).toBeGreaterThan(-1);
    expect(addBreakIdx).toBeGreaterThan(detailIdx);
  });
});

describe('DrawingTab ribbon — Detail (Rect) button', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('renders "Detail (Rect)" button in Place Views panel', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /detail \(rect\)/i })).toBeInTheDocument();
  });

  it('"Detail (Rect)" button is disabled when no projected view exists', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /detail \(rect\)/i });
    // seedDrawing() has no views, so hasProjectedView=false
    expect(btn).toBeDisabled();
  });

  it('clicking "Detail (Rect)" calls enterDetailRectMode', () => {
    // Seed a drawing with a base view that has a projection to enable the button
    const drwWithProj: DrawingDocument = {
      ...seedDrawing(),
      sheets: [{
        ...seedDrawing().sheets[0]!,
        views: [{
          id: 'bv1', kind: 'base' as const, positionMm: { x: 0, y: 0 },
          scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const,
          showHidden: false,
          projection: {
            visibleEdges: [], hiddenEdges: [],
            bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
          },
          inputFingerprint: 'bv1-fp',
        }],
      }],
    };
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: drwWithProj });
    render(<DrawingTab />);
    const btn = screen.getByRole('button', { name: /detail \(rect\)/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(useToolModeStore.getState().mode).toBe('detailRect');
  });
});

describe('DrawingTab — non-drawing active doc', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
  });

  it('renders the stub when no document is active', () => {
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
    expect(screen.queryByText('Sheet')).not.toBeInTheDocument();
  });

  it('renders the stub when a part is active', () => {
    useAppStore.getState().setActiveDocument({
      kind: 'part',
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {}, properties: {},
        featureTree: [], materials: [], hardware: [],
      },
    });
    render(<DrawingTab />);
    expect(screen.getByText(/drawing generation/i)).toBeInTheDocument();
  });
});

describe('DrawingTab — Stepped Section ribbon button (F1.2)', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
  });

  it('renders a button with aria-label="Stepped Section"', () => {
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Stepped Section' })).toBeInTheDocument();
  });

  it('clicking "Stepped Section" sets mode to "pickSteppedSection"', () => {
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Stepped Section' }));
    const s = useToolModeStore.getState();
    expect(s.mode).toBe('pickSteppedSection');
    expect(s.steppedSectionState.stage).toBe('pickParent');
  });

  it('button is positioned adjacent to "Half Section" (DOM order)', () => {
    render(<DrawingTab />);
    const half = screen.getByRole('button', { name: 'Half Section' });
    const stepped = screen.getByRole('button', { name: 'Stepped Section' });
    // Walk DOM: stepped must follow half in the same parent.
    expect(half.parentElement).toBe(stepped.parentElement);
    const siblings = Array.from(half.parentElement!.children);
    expect(siblings.indexOf(stepped)).toBeGreaterThan(siblings.indexOf(half));
  });
});

describe('DrawingTab — All-sheets DXF export buttons', () => {
  beforeEach(() => {
    useToolModeStore.getState().reset();
    useAppStore.getState().setActiveDocument(null);
    // An earlier test in this file sets activeDrawingSourceDocument and never clears it;
    // setActiveDocument(null) does NOT touch that slot. Clear it so `source` is truly null
    // for ALLBTN-3 (the Zustand store is a shared singleton across describes in one file).
    useAppStore.setState({ activeDrawingSourceDocument: null } as never);
  });

  const projView = {
    id: 'bv1', kind: 'base' as const, positionMm: { x: 20, y: 20 },
    scale: { numerator: 1, denominator: 1 }, orientation: 'front' as const, showHidden: false,
    projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
    inputFingerprint: 'fp1',
  };
  const twoSheetDrawing = (withProjection: boolean): DrawingDocument => {
    const base = seedDrawing();
    const s1 = { ...base.sheets[0]!, views: withProjection ? [projView] : [] };
    const s2 = { ...base.sheets[0]!, id: 'sh2', name: 'Sheet 2', views: withProjection ? [projView] : [] };
    return { ...base, sheets: [s1, s2] };
  };

  it('ALLBTN-1: all-sheets buttons are ABSENT for a single-sheet drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.queryByRole('button', { name: /^export all sheets \(dxf\)$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export all sheets \(1:1\)$/i })).not.toBeInTheDocument();
  });

  it('ALLBTN-2: both all-sheets buttons are PRESENT for a multi-sheet drawing', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).toBeInTheDocument();
  });

  it('ALLBTN-3: all-sheets WYSIWYG is disabled without a source', () => {
    // activePart/activeAssembly/activeDrawingSourceDocument all null
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(dxf\)$/i })).toBeDisabled();
  });

  it('ALLBTN-4: all-sheets 1:1 is disabled when no sheet has a projected view', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(false) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).toBeDisabled();
  });

  it('ALLBTN-5: all-sheets 1:1 is enabled when a sheet has a projected view', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: twoSheetDrawing(true) });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: /^export all sheets \(1:1\)$/i })).not.toBeDisabled();
  });
});

describe('DrawingTab — Edit Detail Region ribbon button (F2.4)', () => {
  const seedDrawingWithDetailView = (): DrawingDocument => ({
    ...seedDrawing(),
    sheets: [
      {
        ...seedDrawing().sheets[0]!,
        views: [
          {
            id: 'bv1', kind: 'base' as const,
            positionMm: { x: 20, y: 20 },
            scale: { numerator: 1, denominator: 1 },
            orientation: 'front' as const,
            showHidden: false,
            projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 80, maxY: 60 } },
            inputFingerprint: 'fp1',
          },
          {
            id: 'dv1', kind: 'detail' as const,
            parentViewId: 'bv1',
            regionParent: { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 },
            label: 'A',
            positionMm: { x: 200, y: 100 },
            scale: { numerator: 2, denominator: 1 },
            showHidden: false,
            projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
            inputFingerprint: 'fp-dv1',
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    useToolModeStore.getState().reset();
  });

  it('renders an "Edit Detail Region" button in the Place Views panel', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Edit Detail Region' })).toBeInTheDocument();
  });

  it('"Edit Detail Region" button is disabled when no detail views exist', () => {
    // seedDrawing() has views: [] → no detail views
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawing() });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Edit Detail Region' })).toBeDisabled();
  });

  it('"Edit Detail Region" button is enabled when at least one detail view exists', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawingWithDetailView() });
    render(<DrawingTab />);
    expect(screen.getByRole('button', { name: 'Edit Detail Region' })).not.toBeDisabled();
  });

  it('clicking "Edit Detail Region" enters editDetailRegion mode', () => {
    useAppStore.getState().setActiveDocument({ kind: 'drawing', document: seedDrawingWithDetailView() });
    render(<DrawingTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Detail Region' }));
    expect(useToolModeStore.getState().mode).toBe('editDetailRegion');
  });
});
