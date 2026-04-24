import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Ribbon from '../Ribbon';

describe('Ribbon', () => {
  it('shows all 7 tabs and Model is active by default', () => {
    render(<Ribbon />);
    for (const label of ['File', 'Model', 'Sketch', 'Furniture', 'Inspect', 'Drawing', 'View']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('tab', { name: 'Model' }).getAttribute('aria-selected')).toBe('true');
  });

  it('switching to Furniture shows the stub notice', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Furniture' }));
    expect(screen.getByText(/sub-project 5/i)).toBeTruthy();
  });

  it('switching to Inspect references sub-project 3', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }));
    expect(screen.getByText(/sub-project 3/i)).toBeTruthy();
  });

  it('switching to Drawing references sub-project 6', () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByRole('tab', { name: 'Drawing' }));
    expect(screen.getByText(/sub-project 6/i)).toBeTruthy();
  });

  it('Model tab shows Fillet, Chamfer, Shell buttons in the Modify panel', () => {
    render(<Ribbon />);
    // Model is active by default, so the Modify panel buttons are rendered.
    expect(screen.getByRole('button', { name: /Fillet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chamfer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Shell/ })).toBeTruthy();
  });
});
