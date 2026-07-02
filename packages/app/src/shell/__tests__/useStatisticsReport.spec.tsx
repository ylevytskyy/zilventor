import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AssemblyDocument, BoreOp } from '@zilventor/shared';
import { useAppStore } from '../../store/useAppStore';
import { CutListCacheContext, type CutListCacheContextValue } from '../CutListCacheContext';
import type { PanelSpecCache } from '../resolvePanelSpec';
import { useStatisticsReport } from '../useStatisticsReport';

function makeAsm(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'demo', units: 'mm', parameters: {}, properties: {},
    components: [
      { id: 'p1', partPath: 'parts/side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'p2', partPath: 'parts/rod.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'p3', partPath: 'hardware/hinge-35mm-cup-full.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [
      { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
      { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
      { id: 'm-rod', name: 'Oak trim rod', defaultThickness: 20, color: '#a97a4a', kind: 'linear' },
    ],
    hardware: [],
    ...overrides,
  };
}

function makeCacheValue(): CutListCacheContextValue {
  const panelSpecCacheRef = {
    current: new Map([
      ['parts/side.zipt', {
        length: 600, width: 400, thickness: 18, materialId: 'm-birch', grain: 'length' as const,
        edgeBands: {
          front: { materialId: 'm-pvc', thickness: 0.4 },
          back: null, left: null, right: null,
        },
      }],
      ['parts/rod.zipt', {
        length: 958, width: 40, thickness: 20, materialId: 'm-rod', grain: 'length' as const,
        edgeBands: { front: null, back: null, left: null, right: null },
      }],
    ]) as PanelSpecCache,
  };
  const partBoresCacheRef = {
    current: new Map<string, BoreOp[]>([
      ['parts/side.zipt', [{
        id: 'b1', face: { featureId: 'panel', role: 'Front', instance: 0 },
        u: 0, v: 0, diameter: 7, depth: 12, role: 'confirmat-face', connectorId: 'j1', connectorKind: 'confirmat',
      }]],
    ]),
  };
  return {
    panelSpecCacheRef,
    partInfoCacheRef: { current: new Map() },
    partBoresCacheRef,
    partGroovesCacheRef: { current: new Map() },
    partTenonMortisesCacheRef: { current: new Map() },
    diagnosticsCacheRef: { current: [] },
    warmCache: () => Promise.resolve(),
    invalidatePartPaths: () => Promise.resolve(),
  };
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <CutListCacheContext.Provider value={makeCacheValue()}>
      {children}
    </CutListCacheContext.Provider>
  );
}

describe('useStatisticsReport', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: null, activeAssembly: null, subAssemblyDocs: {}, defaultPriceBook: {},
    });
  });

  it('returns the empty report when no assembly is active', () => {
    const { result } = renderHook(() => useStatisticsReport(), { wrapper });
    expect(result.current).toEqual({ sections: [], grandTotal: 0, unpricedLineCount: 0 });
  });

  it('composes all five categories from the real aggregators for a fixture assembly', () => {
    const asm = makeAsm();
    useAppStore.setState({ activeDocument: { kind: 'assembly', document: asm }, activeAssembly: asm });

    const { result } = renderHook(() => useStatisticsReport(), { wrapper });
    const report = result.current;

    expect(report.sections.map((s) => s.category)).toEqual(['hardware', 'connectors', 'edgeband', 'linear', 'panels']);

    const hardware = report.sections.find((s) => s.category === 'hardware')!;
    expect(hardware.lines).toHaveLength(1);
    expect(hardware.lines[0]!.key).toBe('hardware:hinge-35mm-cup-full');
    expect(hardware.lines[0]!.qty).toBe(1);

    const connectors = report.sections.find((s) => s.category === 'connectors')!;
    expect(connectors.lines).toHaveLength(1);
    expect(connectors.lines[0]!.key).toBe('connector:confirmat');
    expect(connectors.lines[0]!.qty).toBe(1);

    const edgeband = report.sections.find((s) => s.category === 'edgeband')!;
    expect(edgeband.lines).toHaveLength(1);
    expect(edgeband.lines[0]!.key).toBe('edgeband:m-pvc');
    expect(edgeband.lines[0]!.qty).toBe(600);

    const linear = report.sections.find((s) => s.category === 'linear')!;
    expect(linear.lines).toHaveLength(1);
    expect(linear.lines[0]!.key).toBe('linear:m-rod');
    expect(linear.lines[0]!.pieces).toEqual([{ lengthMm: 958, qty: 1 }]);

    const panels = report.sections.find((s) => s.category === 'panels')!;
    expect(panels.lines).toHaveLength(1);
    expect(panels.lines[0]!.key).toBe('material:m-birch');
    expect(panels.lines[0]!.qty).toBeCloseTo((600 * 400) / 1e6, 6);

    // Nothing priced yet.
    expect(report.unpricedLineCount).toBe(5);
    expect(report.grandTotal).toBe(0);
  });

  it('threads per-document unitPrices into computed line/section totals', () => {
    const asm = makeAsm({ unitPrices: { 'hardware:hinge-35mm-cup-full': 12 } });
    useAppStore.setState({ activeDocument: { kind: 'assembly', document: asm }, activeAssembly: asm });

    const { result } = renderHook(() => useStatisticsReport(), { wrapper });
    const report = result.current;

    const hardware = report.sections.find((s) => s.category === 'hardware')!;
    expect(hardware.lines[0]!.unitPrice).toBe(12);
    expect(hardware.lines[0]!.lineTotal).toBe(12);
    expect(hardware.subtotal).toBe(12);
    expect(report.unpricedLineCount).toBe(4);
    expect(report.grandTotal).toBe(12);
  });

  it('falls back to the app-global defaultPriceBook when the document has no override', () => {
    const asm = makeAsm();
    useAppStore.setState({
      activeDocument: { kind: 'assembly', document: asm }, activeAssembly: asm,
      defaultPriceBook: { 'material:m-birch': 25 },
    });

    const { result } = renderHook(() => useStatisticsReport(), { wrapper });
    const panels = result.current.sections.find((s) => s.category === 'panels')!;
    expect(panels.lines[0]!.unitPrice).toBe(25);
  });
});
