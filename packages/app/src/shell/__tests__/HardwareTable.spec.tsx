import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HardwareTable } from '../HardwareTable';
import type { HardwareRow } from '../../assembly/walkers/aggregateHardwareRecursive';

const rows: HardwareRow[] = [
  { skuId: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges', qty: 2, notes: 'Requires 35mm Forstner bit' },
  { skuId: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',          category: 'shelfPins', qty: 8, notes: 'Press-fit' },
];

describe('HardwareTable', () => {
  it('renders "No hardware" placeholder when rows is empty', () => {
    render(<HardwareTable rows={[]} />);
    expect(screen.getByText(/no hardware/i)).toBeTruthy();
  });

  it('renders a row for each hardware entry', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('35mm Cup Hinge — Full Overlay')).toBeTruthy();
    expect(screen.getByText('5mm Shelf Pin — Steel')).toBeTruthy();
  });

  it('displays Qty correctly', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('renders column headers: SKU, Name, Category, Qty, Notes', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('SKU')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Qty')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });
});
