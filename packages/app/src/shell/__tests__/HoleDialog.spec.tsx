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

  it('Distance termination shows a depth field; throughAll does not', () => {
    useAppStore.getState().toggleHoleDialog(true);
    render(<HoleDialog />);
    const term = screen.getByLabelText(/termination/i) as HTMLSelectElement;
    fireEvent.change(term, { target: { value: 'distance' } });
    expect(screen.getByLabelText(/^depth$/i)).toBeInTheDocument();
    fireEvent.change(term, { target: { value: 'throughAll' } });
    expect(screen.queryByLabelText(/^depth$/i)).toBeNull();
  });

  it('OK closes the dialog', () => {
    useAppStore.getState().toggleHoleDialog(true);
    useAppStore.setState((s) => ({ ...s, holeSketchId: 'S1' }));
    render(<HoleDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(useAppStore.getState().holeDialogOpen).toBe(false);
  });

  it('OK in fromSketch+simple+throughAll mode adds a HoleFeature to the active part', () => {
    const part = { id: 'part-1', name: 'Part1', units: 'mm' as const, parameters: {}, featureTree: [] };
    useAppStore.getState().setActivePart(part);
    useAppStore.getState().toggleHoleDialog(true);
    useAppStore.setState((s) => ({ ...s, holeSketchId: 'S1' }));
    render(<HoleDialog />);

    const sizeBefore = useAppStore.getState().activePart?.featureTree?.length ?? 0;
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    const sizeAfter = useAppStore.getState().activePart?.featureTree?.length ?? 0;

    expect(sizeAfter).toBe(sizeBefore + 1);
    const tree = useAppStore.getState().activePart?.featureTree ?? [];
    const last = tree[tree.length - 1];
    expect(last?.kind).toBe('hole');
  });

  it('rehydrate: opens a stored CBORE hole with all dialog fields populated', () => {
    const stored: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'counterbore',
        diameter: { kind: 'literal', value: 4 },
        cboreDiameter: { kind: 'literal', value: 8 },
        cboreDepth: { kind: 'literal', value: 2 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 6 } },
      flipAxis: true,
    };
    useAppStore.setState((s) => ({
      ...s,
      activePart: { id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [stored] } as any,
    }));
    useAppStore.getState().openHoleForEdit('H1');

    render(<HoleDialog />);
    expect((screen.getByLabelText(/^Diameter$/i) as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText(/CBORE Ø/i) as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText(/CBORE depth/i) as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText(/^Depth$/i) as HTMLInputElement).value).toBe('6');
  });
});
