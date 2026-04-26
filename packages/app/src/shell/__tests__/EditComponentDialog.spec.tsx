import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditComponentDialog } from '../EditComponentDialog';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';

describe('EditComponentDialog', () => {
  const initial: ComponentInstance = {
    id: 'C1', partPath: 'parts/leg.zipt',
    position: { x: 10, y: 20, z: 30 },
    rotation: { rx: 0, ry: 90, rz: 0 },
    visible: true,
  };
  const baseProps = {
    initial,
    onCommit: () => {},
    onCancel: () => {},
  };

  it('renders position + rotation + visibility controls with initial values', () => {
    render(<EditComponentDialog {...baseProps} />);
    expect((screen.getByLabelText(/^X$/i) as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText(/^Y$/i) as HTMLInputElement).value).toBe('20');
    expect((screen.getByLabelText(/^Z$/i) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(/^RX$/i) as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText(/^RY$/i) as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText(/visible/i) as HTMLInputElement).checked).toBe(true);
  });

  it('OK fires onCommit with the edited values', () => {
    const onCommit = vi.fn();
    render(<EditComponentDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText(/^X$/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      position: { x: 50, y: 20, z: 30 },
    }));
  });
});

describe('EditComponentDialog — color row (4c)', () => {
  const seedAssembly = (overrides: Partial<AssemblyDocument> = {}): void => {
    const c: ComponentInstance = {
      id: 'C1', partPath: 'parts/leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    const assembly: AssemblyDocument = {
      id: 'A', name: 'A', units: 'mm', parameters: {},
      components: [c],
      constraints: [], groundedComponentIds: ['C1'],
      colors: {}, bomItemNumbers: {},
      ...overrides,
    };
    useAppStore.setState({
      activeAssembly: assembly,
      activeDocument: { kind: 'assembly', document: assembly },
      editingComponentId: 'C1',
    } as any);
  };

  it('renders the existing color, edits to (no color), and dispatches setComponentColor', () => {
    const componentWithColor: ComponentInstance = {
      id: 'C1', partPath: 'parts/leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
      color: { kind: 'palette', name: 'Maple' },
    };
    seedAssembly({ components: [componentWithColor], colors: { Maple: '#d4a574' } });

    render(
      <EditComponentDialog
        initial={componentWithColor}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );

    const select = screen.getByLabelText('component-color') as HTMLSelectElement;
    expect(select.value).toBe('palette:Maple');

    fireEvent.change(select, { target: { value: '__none__' } });
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    expect(useAppStore.getState().activeAssembly!.components[0]!.color).toBeUndefined();
  });

  it('lets the user add a new palette color and select it', () => {
    seedAssembly();

    const initial: ComponentInstance = {
      id: 'C1', partPath: 'parts/leg.zipt',
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    };
    render(
      <EditComponentDialog
        initial={initial}
        onCommit={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText('component-color'), {
      target: { value: '__newPalette__' },
    });
    fireEvent.change(screen.getByLabelText('palette-name'), {
      target: { value: 'Cherry' },
    });
    // Two OK buttons exist while inline form is open: pick the first (inline form OK).
    fireEvent.click(screen.getAllByRole('button', { name: /^ok$/i })[0]!);

    // After inline form closes, only the dialog's OK remains.
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));

    const a = useAppStore.getState().activeAssembly!;
    expect(a.colors.Cherry).toBeDefined();
    expect(a.components[0]!.color).toEqual({ kind: 'palette', name: 'Cherry' });
  });
});