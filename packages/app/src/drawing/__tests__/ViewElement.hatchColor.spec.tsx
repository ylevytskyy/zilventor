// packages/app/src/drawing/__tests__/ViewElement.hatchColor.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ViewElement } from '../ViewElement';
import type { SectionView } from '@zilventor/shared';

const SECTION_VIEW_COLORED: SectionView = {
  id: 'v-sec-color',
  kind: 'section',
  label: 'B',
  parentViewId: 'v-base',
  sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
  arrowDirection: 1,
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'full',
  hatchSegments: [
    { p0: { x: 10, y: 5 }, p1: { x: 40, y: 5 }, materialId: 'mat-red', color: '#123456' },
    { p0: { x: 10, y: 8 }, p1: { x: 40, y: 8 }, materialId: 'mat-default' }, // no color
  ],
  projection: {
    visibleEdges: [{ id: 'e0', kind: 'outline', points: [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  fingerprint: 'fp-color',
};

describe('ViewElement — hatch color', () => {
  it('hatch <line> with color uses seg.color as stroke', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_COLORED} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const hatchLines = container.querySelectorAll('line[data-role="hatch"]');
    expect(hatchLines).toHaveLength(2);

    // First segment has color '#123456'
    const first = hatchLines[0]!;
    expect(first.getAttribute('stroke')).toBe('#123456');
  });

  it('hatch <line> without color falls back to "black"', () => {
    const { container } = render(
      <svg>
        <ViewElement view={SECTION_VIEW_COLORED} sheetZoom={1} isStale={false} onRegenerate={vi.fn()} />
      </svg>,
    );
    const hatchLines = container.querySelectorAll('line[data-role="hatch"]');
    // Second segment has no color → should default to 'black'
    const second = hatchLines[1]!;
    expect(second.getAttribute('stroke')).toBe('black');
  });
});
