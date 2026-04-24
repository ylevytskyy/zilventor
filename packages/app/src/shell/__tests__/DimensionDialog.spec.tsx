import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DimensionDialog } from '../DimensionDialog';

describe('DimensionDialog', () => {
  it('renders with prefilled name and value; OK fires onCommit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DimensionDialog initialName="d0" initialExpression="50" unit="mm" onCommit={onCommit} onCancel={onCancel} cursor={{ x: 100, y: 100 }} />);
    expect(screen.getByLabelText(/Name/i)).toHaveValue('d0');
    expect(screen.getByLabelText(/Value/i)).toHaveValue('50');
    fireEvent.click(screen.getByRole('button', { name: /^OK$/ }));
    expect(onCommit).toHaveBeenCalledWith({ name: 'd0', expression: '50' });
  });

  it('Cancel fires onCancel and does not commit', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DimensionDialog initialName="d1" initialExpression="25" unit="mm" onCommit={onCommit} onCancel={onCancel} cursor={{ x: 0, y: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
