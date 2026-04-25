import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '../../store/useAppStore';
import { HoleDialog } from '../HoleDialog';

describe('HoleDialog', () => {
  beforeEach(() => {
    useAppStore.getState().resetHoleDialog();
  });

  it('returns null when dialog is closed', () => {
    const { container } = render(<HoleDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the four section headings + footer buttons when open', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    expect(screen.getByRole('heading', { name: /placement/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /termination/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
  });

  it('radio group switches mode-specific pick rows', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    // default = fromSketch → "Pick sketch" button visible
    expect(screen.getByText(/pick sketch/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /linear/i }));
    expect(screen.getByText(/pick edge 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/pick sketch/i)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /concentric/i }));
    expect(screen.getByText(/pick circular edge/i)).toBeInTheDocument();
    expect(screen.queryByText(/pick edge 1/i)).toBeNull();
  });
});
