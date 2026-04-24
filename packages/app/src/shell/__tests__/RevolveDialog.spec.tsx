import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevolveDialog } from '../RevolveDialog';

describe('RevolveDialog (layout)', () => {
  it('renders Profile + Axis fields, Extents dropdown, Angle input, Operation icons', () => {
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={null}
      hasRunningBody={false}
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
    />);
    expect(screen.getByText(/Profile/i)).toBeInTheDocument();
    expect(screen.getByText(/Axis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Angle/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Join/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cut/ })).toBeDisabled();
  });

  it('OK is disabled until axis is picked', () => {
    const onCommit = vi.fn();
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={null}
      hasRunningBody={false}
      onCommit={onCommit}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
    />);
    const ok = screen.getByRole('button', { name: /^OK$/ });
    expect(ok).toBeDisabled();
    fireEvent.click(ok);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
