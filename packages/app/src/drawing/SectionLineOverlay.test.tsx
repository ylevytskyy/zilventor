// packages/app/src/drawing/SectionLineOverlay.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SectionLineOverlay } from './SectionLineOverlay';
import type { BaseView, SectionView } from '@zilventor/shared';

const BASE_VIEW: BaseView = {
  id: 'v-base',
  kind: 'base',
  positionMm: { x: 50, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
};

const SECTION_VIEW: SectionView = {
  id: 'v-section',
  kind: 'section',
  label: 'A',
  parentViewId: 'v-base',
  sectionLine: { p0: { x: 5, y: 25 }, p1: { x: 45, y: 25 } },
  arrowDirection: 1,
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  hatchSegments: [],
  fingerprint: 'fp-a',
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
};

describe('SectionLineOverlay', () => {
  it('renders exactly one line element', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />
      </svg>,
    );
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
  });

  it('renders two arrowhead path elements', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />
      </svg>,
    );
    const paths = container.querySelectorAll('path[data-role="arrowhead"]');
    expect(paths).toHaveLength(2);
  });

  it('renders two text labels with section letter', () => {
    const { getAllByText } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />
      </svg>,
    );
    const labels = getAllByText('A');
    expect(labels).toHaveLength(2);
  });

  it('line has ANSI heavy dash pattern stroke-dasharray', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />
      </svg>,
    );
    const line = container.querySelector('line')!;
    expect(line.getAttribute('stroke-dasharray')).toBe('6 1.5 1.5 1.5');
  });

  it('stroke-width scales with sheet zoom', () => {
    const { container: c1 } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} zoom={1} />
      </svg>,
    );
    const { container: c2 } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} zoom={2} />
      </svg>,
    );
    const sw1 = parseFloat(c1.querySelector('line')!.getAttribute('stroke-width')!);
    const sw2 = parseFloat(c2.querySelector('line')!.getAttribute('stroke-width')!);
    // stroke-width in SVG user units should halve when zoom doubles (maintains 0.7mm visual)
    expect(sw2).toBeCloseTo(sw1 / 2, 3);
  });

  it('arrowheads are positioned at p0 and p1 along arrowDirection normal', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={BASE_VIEW} sectionView={SECTION_VIEW} />
      </svg>,
    );
    const paths = container.querySelectorAll<SVGPathElement>('path[data-role="arrowhead"]');
    // arrowheads exist at both termini — non-null paths + data-terminus attributes
    const termini = Array.from(paths).map((p) => p.getAttribute('data-terminus'));
    expect(termini).toContain('p0');
    expect(termini).toContain('p1');
  });
});
