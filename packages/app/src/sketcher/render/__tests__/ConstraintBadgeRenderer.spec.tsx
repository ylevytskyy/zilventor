import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConstraintBadgeRenderer } from '../ConstraintBadgeRenderer';
import { useAppStore } from '../../../store/useAppStore';
import { RemoveConstraintCommand } from '../../../commands/RemoveConstraintCommand';
import type { SketchConstraint, SketchPrimitive } from '@zilventor/shared';

describe('ConstraintBadgeRenderer', () => {
  it('renders one badge per constraint with the correct glyph', () => {
    const primitives: SketchPrimitive[] = [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }];
    const constraints: SketchConstraint[] = [
      { id: 'c1', kind: 'horizontal', line: 'L1' },
      { id: 'c2', kind: 'parallel', line1: 'L1', line2: 'L1' }
    ];
    const worldToScreen = (x: number, y: number) => ({ x, y });
    render(<ConstraintBadgeRenderer primitives={primitives} constraints={constraints} worldToScreen={worldToScreen} />);
    expect(screen.getAllByTestId('constraint-badge')).toHaveLength(2);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('∥')).toBeInTheDocument();
  });

  it('positions a line-scoped badge at the midpoint', () => {
    const primitives: SketchPrimitive[] = [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }];
    const constraints: SketchConstraint[] = [{ id: 'c1', kind: 'horizontal', line: 'L1' }];
    const worldToScreen = (x: number, y: number) => ({ x: x * 2, y: y * 2 });
    render(<ConstraintBadgeRenderer primitives={primitives} constraints={constraints} worldToScreen={worldToScreen} />);
    const el = screen.getByTestId('constraint-badge');
    const style = getComputedStyle(el);
    expect(style.left).toBe('100px');
    expect(style.top).toBe('0px');
  });

  it('clicking a badge dispatches RemoveConstraintCommand via bus.execute', () => {
    useAppStore.setState({ activeSketchId: 'S1' } as any);
    const primitives: SketchPrimitive[] = [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }];
    const constraints: SketchConstraint[] = [{ id: 'c1', kind: 'horizontal', line: 'L1' }];
    const worldToScreen = (x: number, y: number) => ({ x, y });
    const bus = useAppStore.getState().bus;
    const spy = vi.spyOn(bus, 'execute');
    render(<ConstraintBadgeRenderer primitives={primitives} constraints={constraints} worldToScreen={worldToScreen} />);
    fireEvent.click(screen.getByTestId('constraint-badge'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBeInstanceOf(RemoveConstraintCommand);
    spy.mockRestore();
  });
});
