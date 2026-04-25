import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkAxisDialog } from '../WorkAxisDialog';

describe('WorkAxisDialog', () => {
  const baseProps = { onCommit: () => {}, onCancel: () => {} };

  it('renders with a mode select containing all 6 modes', () => {
    render(<WorkAxisDialog {...baseProps} />);
    const select = screen.getByLabelText('mode') as HTMLSelectElement;
    expect(select.options).toHaveLength(6);
  });

  it('OK in origin mode commits a workAxis origin source (axis defaults to X)', () => {
    const onCommit = vi.fn();
    render(<WorkAxisDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith({
      source: { mode: 'origin', axis: 'X' },
      parameterExpressions: {},
    });
  });

  it('twoPoints mode emits both pointRefs', () => {
    const onCommit = vi.fn();
    render(<WorkAxisDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'twoPoints' } });
    fireEvent.click(screen.getByText('OK'));
    const arg = onCommit.mock.calls[0]![0];
    expect(arg.source.mode).toBe('twoPoints');
    expect(arg.source.pointA).toEqual({ source: 'workPoint', featureId: 'origin.O' });
    expect(arg.source.pointB).toEqual({ source: 'workPoint', featureId: 'origin.O' });
  });
});
