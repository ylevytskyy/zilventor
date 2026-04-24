import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExtrudeDialog from '../ExtrudeDialog';

describe('ExtrudeDialog (layout)', () => {
  it('shows Operation icon row with Join default when body exists', () => {
    render(
      <ExtrudeDialog
        hasRunningBody={true}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /New/ })).not.toBeDisabled();
    const joinBtn = screen.getByRole('button', { name: /Join/ });
    expect(joinBtn).not.toBeDisabled();
    expect(joinBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Cut/ })).not.toBeDisabled();
  });

  it('disables Join and Cut, defaults New when no running body', () => {
    render(
      <ExtrudeDialog
        hasRunningBody={false}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const newBtn = screen.getByRole('button', { name: /New/ });
    expect(newBtn).not.toBeDisabled();
    expect(newBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Join/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cut/ })).toBeDisabled();
  });

  it('OK fires onCommit with selected operation', () => {
    const onCommit = vi.fn();
    render(
      <ExtrudeDialog
        hasRunningBody={true}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    // Default when hasRunningBody=true is 'join'; switch to 'cut'
    fireEvent.click(screen.getByRole('button', { name: /Cut/ }));
    fireEvent.click(screen.getByRole('button', { name: /^OK$/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'cut', distance: '18' })
    );
  });

  it('Cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ExtrudeDialog
        hasRunningBody={false}
        onCommit={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
