import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkPointDialog } from '../WorkPointDialog';

describe('WorkPointDialog', () => {
  const baseProps = { onCommit: () => {}, onCancel: () => {} };

  it('renders with a mode select containing all 6 modes', () => {
    render(<WorkPointDialog {...baseProps} />);
    const select = screen.getByLabelText('mode') as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
  });

  it('OK in origin mode commits a workPoint origin source', () => {
    const onCommit = vi.fn();
    render(<WorkPointDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith({
      source: { mode: 'origin' },
      parameterExpressions: {},
    });
  });

  it('threePlanes mode emits 3 plane refs', () => {
    const onCommit = vi.fn();
    render(<WorkPointDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'threePlanes' } });
    fireEvent.click(screen.getByText('OK'));
    const arg = onCommit.mock.calls[0]![0];
    expect(arg.source.mode).toBe('threePlanes');
    expect(arg.source.planes).toHaveLength(3);
    expect(arg.source.planes[0]).toEqual({ source: 'workPlane', featureId: 'origin.XY' });
  });
});
