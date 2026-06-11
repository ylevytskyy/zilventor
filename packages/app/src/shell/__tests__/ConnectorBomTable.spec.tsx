import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectorBomTable } from '../ConnectorBomTable';
import type { ConnectorBomRow } from '../ConnectorBomTable';

// Mock react-i18next so t(key) returns the key for snapshot-stable assertions
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const sampleRows: ConnectorBomRow[] = [
  { kind: 'confirmat', name: 'Confirmat 7×50',    qty: 4,  notes: 'Ø7 face + Ø5 edge' },
  { kind: 'shelfPin',  name: 'Shelf pin Ø5',      qty: 16, notes: 'система-32' },
  { kind: 'hinge',     name: 'Hinge Ø35 cup',     qty: 2,  notes: '+ 2 plate screws' },
];

describe('ConnectorBomTable', () => {
  it('renders the section heading via t("common.connectors")', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.getByText('common.connectors')).toBeTruthy();
  });

  it('renders column headers via t("table.connector.*")', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.getByText('table.connector.type')).toBeTruthy();
    expect(screen.getByText('table.connector.name')).toBeTruthy();
    expect(screen.getByText('table.connector.qty')).toBeTruthy();
    expect(screen.getByText('table.connector.notes')).toBeTruthy();
  });

  it('renders a row for each item with correct name and qty', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.getByText('Confirmat 7×50')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Shelf pin Ø5')).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getByText('Hinge Ø35 cup')).toBeTruthy();
  });

  it('renders kind identifiers in the first column', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.getByText('confirmat')).toBeTruthy();
    expect(screen.getByText('shelfPin')).toBeTruthy();
    expect(screen.getByText('hinge')).toBeTruthy();
  });

  it('renders notes text', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.getByText('Ø7 face + Ø5 edge')).toBeTruthy();
    expect(screen.getByText('система-32')).toBeTruthy();
  });

  it('renders empty state via t("common.no_connectors") when rows=[]', () => {
    render(<ConnectorBomTable rows={[]} />);
    expect(screen.getByText('common.no_connectors')).toBeTruthy();
    // No table headers in empty state
    expect(screen.queryByText('table.connector.type')).toBeNull();
  });

  it('FLIP-TO-RED: does NOT render "common.no_connectors" when rows are present', () => {
    render(<ConnectorBomTable rows={sampleRows} />);
    expect(screen.queryByText('common.no_connectors')).toBeNull();
  });
});
