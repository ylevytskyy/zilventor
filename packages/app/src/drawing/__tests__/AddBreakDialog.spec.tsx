import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddBreakDialog } from '../AddBreakDialog';

describe('AddBreakDialog', () => {
  it('renders nothing when open=false', () => {
    render(
      <AddBreakDialog
        open={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/choose break direction/i)).toBeNull();
  });

  it('renders dialog title "Choose break direction" when open=true', () => {
    render(
      <AddBreakDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/choose break direction/i)).toBeInTheDocument();
  });

  it('renders two axis options: "Horizontal break" and "Vertical break"', () => {
    render(
      <AddBreakDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/horizontal break/i)).toBeInTheDocument();
    expect(screen.getByText(/vertical break/i)).toBeInTheDocument();
  });

  it('clicking "Horizontal break (X axis)" button calls onConfirm with axis="x"', () => {
    const onConfirm = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /horizontal break/i }));
    expect(onConfirm).toHaveBeenCalledWith('x');
  });

  it('clicking "Vertical break (Y axis)" button calls onConfirm with axis="y"', () => {
    const onConfirm = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /vertical break/i }));
    expect(onConfirm).toHaveBeenCalledWith('y');
  });

  it('clicking Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <AddBreakDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
