import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaceConstraintDialog } from '../PlaceConstraintDialog';

const noop = () => {};

describe('PlaceConstraintDialog', () => {
  it('renders mate mode by default with Pick buttons', () => {
    render(<PlaceConstraintDialog mode="mate" onPick={noop} pickedRefA={null} pickedRefB={null} valueExpression="0" onValueChange={noop} onCommit={noop} onApply={noop} onCancel={noop} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Selection 1/)).toBeInTheDocument();
    expect(screen.getByText(/Selection 2/)).toBeInTheDocument();
  });
  it('shows Angle label for angle mode', () => {
    render(<PlaceConstraintDialog mode="angle" onPick={noop} pickedRefA={null} pickedRefB={null} valueExpression="0" onValueChange={noop} onCommit={noop} onApply={noop} onCancel={noop} />);
    expect(screen.getByText(/Angle/)).toBeInTheDocument();
  });
  it('Pick button fires onPick with the slot role', () => {
    const onPick = vi.fn();
    render(<PlaceConstraintDialog mode="mate" onPick={onPick} pickedRefA={null} pickedRefB={null} valueExpression="0" onValueChange={noop} onCommit={noop} onApply={noop} onCancel={noop} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Pick/ })[0]!);
    expect(onPick).toHaveBeenCalledWith('A');
  });
  it('OK is disabled until both refs picked', () => {
    render(<PlaceConstraintDialog mode="mate" onPick={noop} pickedRefA={null} pickedRefB={null} valueExpression="0" onValueChange={noop} onCommit={noop} onApply={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });
});
