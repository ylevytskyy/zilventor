import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QrScanButton } from './QrScanButton';

describe('QrScanButton', () => {
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true
    });
  });

  it('renders a disabled/inert button without throwing when navigator.mediaDevices is undefined', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });

    expect(() => render(<QrScanButton onScan={() => {}} />)).not.toThrow();

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('is enabled when navigator.mediaDevices is present', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [] }) },
      configurable: true
    });

    render(<QrScanButton onScan={() => {}} />);

    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});
