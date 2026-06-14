// packages/app/src/shell/__tests__/ClashReportPanel.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ClashReportPanel } from '../ClashReportPanel';
import type { ClashReportRow } from '@zilventor/shared';

const noOp = () => {};

describe('ClashReportPanel', () => {
  it('shows never_run message when ran=false', () => {
    render(<ClashReportPanel rows={null} ran={false} onRowClick={noOp} />);
    expect(screen.getByText(/Run Interference Check/i)).toBeDefined();
  });

  it('shows no_results + disclaimer when ran=true with zero rows', () => {
    render(<ClashReportPanel rows={[]} ran={true} onRowClick={noOp} />);
    expect(screen.getByText(/No interferences found/i)).toBeDefined();
    // Step 1 requirement: disclaimer rendered when check has run
    expect(screen.getByText(/Structural carcass-panel overlaps/i)).toBeDefined();
  });

  it('shows disclaimer alongside results table when rows exist', () => {
    const rows: ClashReportRow[] = [
      {
        aPathKey: 'a', bPathKey: 'b',
        aPath: ['a'], bPath: ['b'],
        aName: 'Left Side', bName: 'Bottom',
        kind: 'interference', volume: 500,
      },
    ];
    render(<ClashReportPanel rows={rows} ran={true} onRowClick={noOp} />);
    // disclaimer still present
    expect(screen.getByText(/Structural carcass-panel overlaps/i)).toBeDefined();
    // table row present
    expect(screen.getByText('Left Side')).toBeDefined();
  });

  it('does NOT show disclaimer when check has not yet run', () => {
    render(<ClashReportPanel rows={null} ran={false} onRowClick={noOp} />);
    const disclaimer = screen.queryByText(/Structural carcass-panel overlaps/i);
    expect(disclaimer).toBeNull();
  });
});
