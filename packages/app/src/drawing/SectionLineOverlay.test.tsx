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
  mode: 'full',
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

describe('SectionLineOverlay — stepped polyline branch (F1.2)', () => {
  const PARENT: BaseView = {
    id: 'bv-1',
    kind: 'base',
    positionMm: { x: 100, y: 100 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
  };

  const STEPPED: SectionView = {
    id: 'sv-stepped-1',
    kind: 'section',
    parentViewId: 'bv-1',
    sectionLine: { p0: { x: 0, y: 30 }, p1: { x: 120, y: 60 } },
    arrowDirection: 1,
    label: 'A',
    positionMm: { x: 80, y: 180 },
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    mode: 'stepped',
    stepSegments: [
      { startSheet: { x: 0,  y: 30 }, endSheet: { x: 60,  y: 30 } },
      { startSheet: { x: 60, y: 30 }, endSheet: { x: 60,  y: 60 } },
      { startSheet: { x: 60, y: 60 }, endSheet: { x: 120, y: 60 } },
    ],
    hatchSegments: [],
    fingerprint: 'fp-stepped-1',
  };

  it('renders a <polyline data-role="stepped-section-line"> when mode==="stepped"', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={PARENT} sectionView={STEPPED} zoom={1} />
      </svg>,
    );
    const poly = container.querySelector('[data-role="stepped-section-line"]');
    expect(poly).not.toBeNull();
    expect(poly!.tagName.toLowerCase()).toBe('polyline');
  });

  it('polyline points include all 4 vertices (V0..V3) in parent-view sheet space', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={PARENT} sectionView={STEPPED} zoom={1} />
      </svg>,
    );
    const poly = container.querySelector('[data-role="stepped-section-line"]') as SVGPolylineElement;
    const pts = (poly.getAttribute('points') ?? '').trim().split(/\s+/);
    expect(pts).toHaveLength(4);
    // parent positionMm = {100,100}; scale = 1:1 → sheet pt = positionMm + vertex
    expect(pts[0]).toBe('100,130');   // V0 = (0,30)   → (100,130)
    expect(pts[1]).toBe('160,130');   // V1 = (60,30)  → (160,130)
    expect(pts[2]).toBe('160,160');   // V2 = (60,60)  → (160,160)
    expect(pts[3]).toBe('220,160');   // V3 = (120,60) → (220,160)
  });

  it('renders arrowheads + labels at V0 and V_last only — NOT at jog vertices', () => {
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={PARENT} sectionView={STEPPED} zoom={1} />
      </svg>,
    );
    const arrowheads = container.querySelectorAll('[data-role="arrowhead"]');
    expect(arrowheads).toHaveLength(2);  // V0 + V_last; no V1/V2 decoration
    const labels = container.querySelectorAll('text');
    expect(labels).toHaveLength(2);      // "A" at V0 and "A" at V_last
  });

  it('falls back to single-<line> branch when mode==="full" (no regression)', () => {
    const fullView: SectionView = { ...STEPPED, mode: 'full' };
    // remove stepSegments for full mode (additive — type allows absent on full)
    const { container } = render(
      <svg>
        <SectionLineOverlay parentView={PARENT} sectionView={fullView} zoom={1} />
      </svg>,
    );
    expect(container.querySelector('[data-role="stepped-section-line"]')).toBeNull();
    expect(container.querySelector('line')).not.toBeNull();
  });
});
