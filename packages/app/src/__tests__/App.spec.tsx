import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App shell', () => {
  it('renders all six regions with stable IDs', () => {
    render(<App />);
    for (const id of ['region-appbar', 'region-ribbon', 'region-browser', 'region-viewport', 'region-properties', 'region-statusbar']) {
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(screen.getByText('ZilInventor')).toBeTruthy();
  });
});
