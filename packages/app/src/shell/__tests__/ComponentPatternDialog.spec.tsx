// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentPatternDialog } from '../ComponentPatternDialog';

const COMPONENTS = [
  { id: 'c1', label: 'shelf-panel' },
  { id: 'c2', label: 'side-panel' },
];

describe('ComponentPatternDialog', () => {
  it('renders with source dropdown and axis buttons', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Source component')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Y' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Z' })).toBeInTheDocument();
  });

  it('OK disabled when count < 2', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const countInput = screen.getByLabelText('Count 1');
    fireEvent.change(countInput, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('OK disabled when spacing is 0', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const spacingInput = screen.getByLabelText('Spacing 1');
    fireEvent.change(spacingInput, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('onCommit called with correct values on OK', () => {
    const onCommit = vi.fn();
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );
    // defaults: source=c1, dir1=x, count=3, spacing=10
    fireEvent.submit(screen.getByRole('dialog'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceComponentId: 'c1', dir1: 'x', count1: expect.any(Number), spacing1: expect.any(Number) })
    );
  });

  it('dir2≠dir1 validation: same axis disables OK when second direction checkbox enabled', () => {
    render(
      <ComponentPatternDialog
        components={COMPONENTS}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByLabelText('Second direction');
    fireEvent.click(checkbox);
    // dir1 defaults to X; click X for dir2 as well
    const xButtons = screen.getAllByRole('button', { name: 'X' });
    fireEvent.click(xButtons[1]!); // second X button is dir2
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });
});
