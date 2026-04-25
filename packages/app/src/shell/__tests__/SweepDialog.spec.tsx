import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SweepDialog } from '../SweepDialog';

describe('SweepDialog', () => {
  const baseProps = {
    profileSketchId: null as string | null,
    pathSketchId: null as string | null,
    orientationKind: 'path' as const,
    guideRailSketchId: null as string | null,
    operation: 'new' as const,
    hasRunningBody: true,
    previewError: null,
    onCommit: () => {},
    onCancel: () => {},
    onPickProfile: () => {},
    onPickPath: () => {},
    onPickGuideRail: () => {},
    onSetOrientation: () => {},
    onSetOperation: () => {},
  };

  it('renders five section headings + footer buttons', () => {
    render(<SweepDialog {...baseProps} />);
    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^path$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /orientation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /operation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  });

  it('OK is disabled until profile + path are picked', () => {
    const { rerender } = render(<SweepDialog {...baseProps} />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
    rerender(<SweepDialog {...baseProps} profileSketchId="P" />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
    rerender(<SweepDialog {...baseProps} profileSketchId="P" pathSketchId="A" />);
    expect(screen.getByRole('button', { name: /^ok$/i })).not.toBeDisabled();
  });

  it('Guide Rail mode disables OK until guide rail picked', () => {
    const { rerender } = render(
      <SweepDialog {...baseProps} profileSketchId="P" pathSketchId="A" orientationKind="guideRail" />
    );
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
    rerender(
      <SweepDialog {...baseProps} profileSketchId="P" pathSketchId="A" orientationKind="guideRail" guideRailSketchId="G" />
    );
    expect(screen.getByRole('button', { name: /^ok$/i })).not.toBeDisabled();
  });

  it('renders previewError when set', () => {
    render(<SweepDialog {...baseProps} previewError="bad path" />);
    expect(screen.getByText(/bad path/i)).toBeInTheDocument();
  });

  it('onCommit fires with the right payload on OK', () => {
    const onCommit = vi.fn();
    render(
      <SweepDialog {...baseProps} profileSketchId="P" pathSketchId="A" operation="join" onCommit={onCommit} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onCommit).toHaveBeenCalledWith({
      orientation: { kind: 'path' },
      operation: 'join',
    });
  });
});
