import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DimensionRenderer } from '../DimensionRenderer';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';

const worldToScreen = (x: number, y: number) => ({ x, y });

// Shared fixtures for inline-edit tests
const LINE_PRIM: SketchPrimitive = { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 };

const DIM_LITERAL: DimensionConstraint = {
  id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'l1',
  value: { kind: 'literal', value: 50 }
};

const DIM_PARAM: DimensionConstraint = {
  id: 'd2', kind: 'dim-length', paramName: 'd2', line: 'l1',
  value: { kind: 'param', paramName: 'width' }
};

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

describe('DimensionRenderer — inline edit', () => {
  it('double-click on literal glyph invokes onEditDimension with correct id', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={onEdit}
      />
    );
    const [glyph] = getAllByTestId('dimension-glyph');
    fireEvent.doubleClick(glyph!);
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith('d1');
  });

  it('double-click on param glyph invokes onEditDimension with id (caller decides param vs literal)', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_PARAM]}
        parameterValues={new Map([['width', 50]])}
        worldToScreen={worldToScreen}
        onEditDimension={onEdit}
      />
    );
    const [glyph] = getAllByTestId('dimension-glyph');
    fireEvent.doubleClick(glyph!);
    expect(onEdit).toHaveBeenCalledWith('d2');
  });

  it('when editing is active (editingDimId matches), an input appears seeded with current value', () => {
    const onEdit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={onEdit}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={vi.fn()}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe('50');
  });

  it('pressing Enter in the inline editor invokes onEditCommit with typed value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={onCommit}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('d1', '75');
  });

  it('pressing Escape in the inline editor invokes onEditCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={vi.fn()}
        onEditCancel={onCancel}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('blur on inline editor invokes onEditCommit with current value', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={onCommit}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('d1', '60');
  });

  it('Enter then blur fires onEditCommit exactly once (double-fire guard)', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DimensionRenderer
        primitives={[LINE_PRIM]}
        dimensions={[DIM_LITERAL]}
        parameterValues={new Map()}
        worldToScreen={worldToScreen}
        onEditDimension={vi.fn()}
        editingDimId="d1"
        editingDimInitialValue="50"
        onEditCommit={onCommit}
        onEditCancel={vi.fn()}
      />
    );
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('d1', '75');
  });
});
