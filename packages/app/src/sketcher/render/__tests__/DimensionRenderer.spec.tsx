import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionRenderer } from '../DimensionRenderer';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';

const worldToScreen = (x: number, y: number) => ({ x, y });

describe('DimensionRenderer', () => {
  it('renders a dim-length with a label + two extension lines', () => {
    const primitives: SketchPrimitive[] = [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
        value: { kind: 'literal', value: 100 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 100]])} worldToScreen={worldToScreen} />);
    expect(screen.getAllByTestId('dimension-glyph')).toHaveLength(1);
    expect(screen.getByText('100.00')).toBeInTheDocument();
  });

  it('renders a dim-radius label with R prefix', () => {
    const primitives: SketchPrimitive[] = [{ id: 'C1', kind: 'circle', cx: 50, cy: 50, r: 25 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-radius', paramName: 'd0', circle: 'C1',
        value: { kind: 'literal', value: 25 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 25]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/R\s*25\.00/)).toBeInTheDocument();
  });

  it('renders a dim-diameter label with diameter symbol', () => {
    const primitives: SketchPrimitive[] = [{ id: 'C1', kind: 'circle', cx: 50, cy: 50, r: 25 }];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-diameter', paramName: 'd0', circle: 'C1',
        value: { kind: 'literal', value: 50 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 50]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/⌀\s*50\.00/)).toBeInTheDocument();
  });

  it('renders a dim-angle label with degree symbol', () => {
    const primitives: SketchPrimitive[] = [
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'L2', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
    ];
    const dimensions: DimensionConstraint[] = [
      { id: 'd0', kind: 'dim-angle', paramName: 'd0', line1: 'L1', line2: 'L2',
        value: { kind: 'literal', value: 90 } }
    ];
    render(<DimensionRenderer primitives={primitives} dimensions={dimensions} parameterValues={new Map([['d0', 90]])} worldToScreen={worldToScreen} />);
    expect(screen.getByText(/90\.00°/)).toBeInTheDocument();
  });
});
