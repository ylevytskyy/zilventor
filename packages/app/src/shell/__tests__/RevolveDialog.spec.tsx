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

describe('RevolveDialog validateExpression', () => {
  it('renders inline error under Angle input and disables OK/Apply when validator returns a string', () => {
    const validate = vi.fn((expr: string) =>
      expr === 'bogus' ? "Parse error: can't read 'bogus'" : null
    );
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={{ primitiveId: 'P1' }}
      hasRunningBody={false}
      initialExpression="bogus"
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
      validateExpression={validate}
    />);
    expect(validate).toHaveBeenCalledWith('bogus');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Parse error/);
    expect(screen.getByRole('button', { name: /^OK$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Apply$/ })).toBeDisabled();
  });

  it('clears the inline error and re-enables OK when the validator returns null', () => {
    const validate = (expr: string): string | null =>
      expr.trim() === '' ? 'empty' : null;
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={{ primitiveId: 'P1' }}
      hasRunningBody={false}
      initialExpression="360"
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
      validateExpression={validate}
    />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /^OK$/ })).not.toBeDisabled();
  });
});

describe('RevolveDialog previewError', () => {
  it('renders a "Preview: ..." alert above the action row when previewError is set', () => {
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={{ primitiveId: 'P1' }}
      hasRunningBody={false}
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
      previewError="axis crosses profile"
    />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Preview:\s*axis crosses profile/);
  });

  it('does not render the preview-error alert when previewError is null', () => {
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={{ primitiveId: 'P1' }}
      hasRunningBody={false}
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
      previewError={null}
    />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
