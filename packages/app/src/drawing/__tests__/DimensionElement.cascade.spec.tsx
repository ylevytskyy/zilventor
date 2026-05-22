// packages/app/src/drawing/__tests__/DimensionElement.cascade.spec.tsx
//
// HS-CASCADE-1: Integration test that DimensionElement resolves parametric text
// from live store state at render time, and re-renders correctly when store updates.
//
// NOTE: This file does NOT mock useAppStore (unlike DimensionElement.spec.tsx).
// It uses the real store so that setState → rerender → text-change is observable.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionElement } from '../DimensionElement';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingView, DrawingDimension, PartDocument } from '@zilventor/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeView(): DrawingView {
  return {
    id: 'view1',
    kind: 'base' as const,
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [
        {
          id: 'edge-width',
          kind: 'feature' as const,
          points: [[0, 0], [50, 0]] as ReadonlyArray<readonly [number, number]>,
        },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
  } as DrawingView;
}

function makeDim(sourceParameterName: string): DrawingDimension {
  return {
    id: 'dim-cascade',
    kind: 'linear-h',
    viewId: 'view1',
    from: { kind: 'edge-endpoint', edgeId: 'edge-width', end: 'start' },
    to:   { kind: 'edge-endpoint', edgeId: 'edge-width', end: 'end' },
    offsetMm: 10,
    sourceParameterName,
  } as DrawingDimension;
}

function makePart(widthValue: number): PartDocument {
  return {
    id: 'part1',
    name: 'Box',
    units: 'mm',
    parameters: {
      width: { name: 'width', expression: String(widthValue), value: widthValue, unit: 'mm' },
    },
    featureTree: [],
    properties: {},
    materials: [],
    hardware: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DimensionElement cascade — HS-CASCADE-1', () => {
  beforeEach(() => {
    useAppStore.setState({
      activePart: makePart(50),
    } as never);
  });

  it('renders the live parameter value (width=50)', () => {
    render(
      <svg>
        <DimensionElement dim={makeDim('width')} view={makeView()} />
      </svg>,
    );
    // The [data-dim-text] element should show "50"
    const textEl = document.querySelector('[data-dim-text]');
    expect(textEl?.textContent).toBe('50');
  });

  it('re-renders with updated parameter value (width=75) after store update', () => {
    const { rerender } = render(
      <svg>
        <DimensionElement dim={makeDim('width')} view={makeView()} />
      </svg>,
    );

    // Update store to width=75 (simulating parameter edit + regen)
    useAppStore.setState({
      activePart: makePart(75),
    } as never);

    // Re-render the same component — store is read at render time via useAppStore.getState()
    rerender(
      <svg>
        <DimensionElement dim={makeDim('width')} view={makeView()} />
      </svg>,
    );

    const textEl = document.querySelector('[data-dim-text]');
    expect(textEl?.textContent).toBe('75');
  });

  it('falls back to geometric distance when sourceParameterName is absent from store', () => {
    render(
      <svg>
        <DimensionElement dim={makeDim('deleted_param')} view={makeView()} />
      </svg>,
    );
    // Geometric distance: edge-width from (0,0) to (50,0), measuredVal = |50-0| = 50
    const textEl = document.querySelector('[data-dim-text]');
    expect(textEl?.textContent).toBe('50');
  });
});

// Suppress unused import warning for screen (available for future tests)
void screen;
