// packages/app/src/drawing/__tests__/DimensionElement.f5cascade.spec.tsx
/**
 * Integration test: cascade text resolution for F5 dim kinds.
 *
 * F5 dims (baseline/ordinate/angular) are rendered via renderDrawingSvg (not React tree),
 * so we test the cascade resolver resolveF5DimText directly, plus verify that
 * renderDrawingSvg produces SVG with data-dim-id / data-dim-text attributes for
 * dims with sourceParameterName set.
 *
 * TDD note: this test is GREEN immediately if T20's resolveF5DimText is correct.
 * If resolveF5DimText is broken, these tests fail with a clear error.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { resolveF5DimText } from '../DimensionElementF5Utils';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingSheet } from '@zilventor/shared';

const GROUP_ID = 'group-cascade-test';
const VIEW_ID = 'view-cascade-test';

function makeSheet(_paramValue: number): DrawingSheet {
  return {
    id: 'sheet-c',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A4' },
    orientation: 'landscape',
    views: [{
      id: VIEW_ID,
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'e-datum', kind: 'outline', points: [[-25, -15], [-25, 15]] as readonly (readonly [number, number])[] },
          { id: 'e-to',    kind: 'outline', points: [[25, -15],  [25, 15]]  as readonly (readonly [number, number])[] },
        ],
        hiddenEdges: [],
        bbox: { minX: -25, minY: -15, maxX: 25, maxY: 15 },
      },
      inputFingerprint: 'fp-c',
    }],
    dimensions: [{
      kind: 'baseline',
      id: 'dim-baseline-cascade-test',
      viewId: VIEW_ID,
      groupId: GROUP_ID,
      slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e-to', end: 'start' },
      sourceParameterName: 'width',
    }],
    dimensionGroups: [{
      kind: 'baseline',
      id: GROUP_ID,
      viewId: VIEW_ID,
      datum: { kind: 'edge-endpoint', edgeId: 'e-datum', end: 'start' },
      direction: 'h',
      baseOffsetMm: 20,
      spacingMm: 10,
    }],
    annotations: [],
    titleBlock: {},
  };
}

function makePart(widthValue: number) {
  return {
    id: 'part-cascade',
    name: 'Cascade Part',
    units: 'mm',
    parameters: {
      width: { name: 'width', value: widthValue, unit: 'mm' },
    },
    featureTree: [],
  };
}

describe('DimensionElement — F5 cascade text integration', () => {
  beforeEach(() => {
    useAppStore.setState({
      activePart: makePart(50) as never,
    } as never, false);
  });

  it('resolveF5DimText returns sourceParameterName value when parameter exists', () => {
    const text = resolveF5DimText({ sourceParameterName: 'width' }, 99);
    // Should return '50' (from store.activePart.parameters.width.value = 50)
    expect(text).toBe('50');
  });

  it('resolveF5DimText returns textOverride when set (ignores param)', () => {
    const text = resolveF5DimText({ textOverride: 'CUSTOM', sourceParameterName: 'width' }, 99);
    expect(text).toBe('CUSTOM');
  });

  it('resolveF5DimText returns computedValue when no override or param name', () => {
    const text = resolveF5DimText({}, 42);
    expect(text).toBe('42');
  });

  it('resolveF5DimText updates when activePart.parameters change', () => {
    const textBefore = resolveF5DimText({ sourceParameterName: 'width' }, 0);
    expect(textBefore).toBe('50');

    useAppStore.setState({
      activePart: makePart(75) as never,
    } as never, false);

    const textAfter = resolveF5DimText({ sourceParameterName: 'width' }, 0);
    expect(textAfter).toBe('75');
  });

  it('renderDrawingSvg produces SVG with data-dim-id for baseline dim', () => {
    const sheet = makeSheet(50);
    const source = makePart(50);
    const svgStr = renderDrawingSvg(
      { id: 'drw-c', name: 'Cascade', units: 'mm', source: { partPath: 'p.zipt', sourceKind: 'part' }, properties: {}, sheets: [sheet], activeSheetId: sheet.id } as never,
      sheet as never,
      source as never,
    );
    // renderDrawingSvg should output SVG containing data-dim-id for the baseline dim
    expect(svgStr).toContain('data-dim-id="dim-baseline-cascade-test"');
  });
});
