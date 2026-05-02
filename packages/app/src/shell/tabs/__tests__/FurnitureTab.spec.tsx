import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';
import { newPart } from '@zilventor/kernel/src/adapter/PartDocument';

describe('FurnitureTab', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activePart: null,
      activeAssembly: null,
      activeDocument: null,
      panelDialog: null,
    } as Partial<ReturnType<typeof useAppStore.getState>>);
  });

  it('renders the Create panel with a Panel button', () => {
    render(<FurnitureTab />);
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Panel/i })).toBeInTheDocument();
  });

  it('clicking Panel dispatches OpenPanelDialogCommand (panelDialog slot populated)', async () => {
    useAppStore.getState().setActivePart(newPart('P1'));
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /Panel/i }));
    await waitFor(() => {
      expect(useAppStore.getState().panelDialog).not.toBeNull();
    });
    expect(useAppStore.getState().panelDialog!.mode).toBe('part');
  });

  it('Panel button is disabled when no part and no assembly is active', () => {
    render(<FurnitureTab />);
    const btn = screen.getByRole('button', { name: /Panel/i });
    expect(btn).toBeDisabled();
  });
});
