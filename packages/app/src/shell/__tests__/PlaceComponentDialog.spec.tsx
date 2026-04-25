import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaceComponentDialog } from '../PlaceComponentDialog';

describe('PlaceComponentDialog', () => {
  const tiles = [
    { partPath: 'parts/leg.zipt', name: 'leg', thumbnail: 'data:image/png;base64,iVBOR' },
    { partPath: 'parts/shelf.zipt', name: 'shelf', thumbnail: 'data:image/png;base64,iVBOR' },
  ];
  const baseProps = {
    tiles,
    onPlace: () => {},
    onCancel: () => {},
  };

  it('renders a tile per part', () => {
    render(<PlaceComponentDialog {...baseProps} />);
    expect(screen.getByText('leg')).toBeInTheDocument();
    expect(screen.getByText('shelf')).toBeInTheDocument();
  });

  it('Place is disabled until a tile is selected', () => {
    render(<PlaceComponentDialog {...baseProps} />);
    expect(screen.getByRole('button', { name: /place/i })).toBeDisabled();
    fireEvent.click(screen.getByText('leg'));
    expect(screen.getByRole('button', { name: /place/i })).not.toBeDisabled();
  });

  it('Place fires onPlace with the selected partPath', () => {
    const onPlace = vi.fn();
    render(<PlaceComponentDialog {...baseProps} onPlace={onPlace} />);
    fireEvent.click(screen.getByText('shelf'));
    fireEvent.click(screen.getByRole('button', { name: /place/i }));
    expect(onPlace).toHaveBeenCalledWith('parts/shelf.zipt');
  });
});
