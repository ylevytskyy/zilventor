import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkPlaneDialog } from '../WorkPlaneDialog';

describe('WorkPlaneDialog', () => {
  const baseProps = { onCommit: () => {}, onCancel: () => {} };

  it('renders with a mode select containing all 7 modes', () => {
    render(<WorkPlaneDialog {...baseProps} />);
    const select = screen.getByLabelText('mode') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.options).toHaveLength(7);
  });

  it('OK in origin mode commits a workPlane origin source', () => {
    const onCommit = vi.fn();
    render(<WorkPlaneDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith({
      source: { mode: 'origin', plane: 'XY' },
      parameterExpressions: {},
    });
  });

  it('switching to offsetFromPlane and committing uses the offset literal', () => {
    const onCommit = vi.fn();
    render(<WorkPlaneDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'offsetFromPlane' } });
    fireEvent.change(screen.getByLabelText('offset'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith({
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'literal', value: 25 },
      },
      parameterExpressions: {},
    });
  });

  it('offset prefix "=" emits a parameter expression', () => {
    const onCommit = vi.fn();
    render(<WorkPlaneDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'offsetFromPlane' } });
    fireEvent.change(screen.getByLabelText('offset'), { target: { value: '=h1' } });
    fireEvent.click(screen.getByText('OK'));
    const arg = onCommit.mock.calls[0]![0];
    expect(arg.source.offset).toEqual({ kind: 'param', paramName: 'h1' });
    expect(arg.parameterExpressions.h1).toEqual({ expression: 'h1', unit: 'mm' });
  });

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<WorkPlaneDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
