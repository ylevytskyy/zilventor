import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddLeaderTextDialog } from '../AddLeaderTextDialog';
import { useAppStore } from '../../store/useAppStore';

const mockExecute = vi.fn().mockResolvedValue(undefined);

const pendingLeader = {
  sheetId: 'sh1',
  ann: {
    id: 'a1',
    kind: 'leader' as const,
    viewId: 'v1',
    targetMm: { x: 100, y: 80 },
    textPosMm: { x: 150, y: 60 },
    text: '',
  },
};

describe('AddLeaderTextDialog', () => {
  beforeEach(() => {
    mockExecute.mockClear();
    useAppStore.setState({
      addLeaderTextDialogState: null,
      bus: { execute: mockExecute } as any,
    } as any);
  });

  it('renders nothing when addLeaderTextDialogState is null', () => {
    render(<AddLeaderTextDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a text input when open', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    expect(screen.getByRole('dialog', { name: /leader/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /text/i })).toBeInTheDocument();
  });

  it('OK dispatches AddAnnotationCommand with the typed text and closes', async () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    fireEvent.change(screen.getByRole('textbox', { name: /text/i }), { target: { value: 'Chamfer here' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    await Promise.resolve();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [cmd] = mockExecute.mock.calls[0]!;
    expect((cmd as any).constructor.name).toBe('AddAnnotationCommand');
    expect((cmd as any).opts.sheetId).toBe('sh1');
    expect((cmd as any).opts.ann.text).toBe('Chamfer here');
    expect((cmd as any).opts.ann.kind).toBe('leader');
    expect((useAppStore.getState() as any).addLeaderTextDialogState).toBeNull();
  });

  it('Cancel closes without executing', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mockExecute).not.toHaveBeenCalled();
    expect((useAppStore.getState() as any).addLeaderTextDialogState).toBeNull();
  });

  it('OK button is disabled when text is empty', () => {
    useAppStore.setState({ addLeaderTextDialogState: pendingLeader } as any);
    render(<AddLeaderTextDialog />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
  });
});
