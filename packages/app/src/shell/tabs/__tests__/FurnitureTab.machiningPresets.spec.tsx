import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FurnitureTab from '../FurnitureTab';
import { useAppStore } from '../../../store/useAppStore';

describe('FurnitureTab — Machining Presets ribbon entry', () => {
  beforeEach(() => {
    useAppStore.getState().toggleMachiningPresetsDialog(false);
  });

  it('renders the Machining Presets button', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: /machining presets/i })).toBeTruthy();
  });

  it('clicking it opens the machining presets dialog', () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: /machining presets/i }));
    expect(useAppStore.getState().machiningPresetsDialogOpen).toBe(true);
  });
});
