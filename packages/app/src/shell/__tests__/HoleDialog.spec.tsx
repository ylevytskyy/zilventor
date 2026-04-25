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

  it('CBORE profile reveals cboreDiameter and cboreDepth fields', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    expect(screen.queryByLabelText(/CBORE Ø/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /counterbore/i }));
    expect(screen.getByLabelText(/CBORE Ø/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CBORE depth/i)).toBeInTheDocument();
  });

  it('CSK profile reveals cskDiameter and cskAngle (default 82°)', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    fireEvent.click(screen.getByRole('radio', { name: /countersink/i }));
    expect(screen.getByLabelText(/CSK Ø/i)).toBeInTheDocument();
    const angle = screen.getByLabelText(/CSK angle/i) as HTMLInputElement;
    expect(angle.value).toBe('82');
  });

  it('Diameter field is always visible across all profile kinds', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    expect(screen.getByLabelText(/^diameter$/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /counterbore/i }));
    expect(screen.getByLabelText(/^diameter$/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /countersink/i }));
    expect(screen.getByLabelText(/^diameter$/i)).toBeInTheDocument();
  });
});
