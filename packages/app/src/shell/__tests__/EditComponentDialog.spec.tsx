import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditComponentDialog } from '../EditComponentDialog';
import type { ComponentInstance } from '@zilventor/shared';

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
