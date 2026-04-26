import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ViewTab from '../ViewTab';
import { useAppStore } from '../../../store/useAppStore';

describe('ViewTab Show component colors toggle', () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ showComponentColors: false } as any);
  });

  it('renders the Show component colors button initially in the off state', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show component colors/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent ?? '').not.toMatch(/^✓/);
    expect(btn.textContent ?? '').toMatch(/^Show component colors/);
  });

  it('clicking the button flips showComponentColors and reflects the on state', () => {
    render(<ViewTab />);
    const btn = screen.getByRole('button', { name: /Show component colors/i });
    fireEvent.click(btn);
    expect(useAppStore.getState().showComponentColors).toBe(true);
    const after = screen.getByRole('button', { name: /Show component colors/i });
    expect(after.textContent ?? '').toMatch(/^✓ /);
  });
});
