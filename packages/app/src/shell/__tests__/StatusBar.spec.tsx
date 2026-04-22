import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBar from '../StatusBar';

describe('StatusBar', () => {
  it('shows "Ready" by default', () => {
    render(<StatusBar />);
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('mm')).toBeTruthy();
  });

  it('shows a custom message', () => {
    render(<StatusBar message="Loading CAD kernel…" />);
    expect(screen.getByText(/loading cad kernel/i)).toBeTruthy();
  });

  it('shows the Modified indicator when modified', () => {
    render(<StatusBar modified />);
    expect(screen.getByText(/modified/i)).toBeTruthy();
  });

  it('shows selection info when provided', () => {
    render(<StatusBar selection="1 selected" />);
    expect(screen.getByText('1 selected')).toBeTruthy();
  });
});
