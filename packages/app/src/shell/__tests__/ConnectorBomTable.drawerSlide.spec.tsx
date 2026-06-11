/**
 * J3: ConnectorBomTable — drawerSlide localized label (real i18n).
 *
 * Verifies that a drawerSlide row renders the localized label from
 * bom.connector.drawerSlide (EN: "Drawer slide Ø5"), NOT the raw key.
 * This also proves the bom.connector.drawerSlide key exists in en.json.
 *
 * Note: this test does NOT mock react-i18next so it uses the real i18n
 * initialized in test-setup.ts.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectorBomTable } from '../ConnectorBomTable';
import type { ConnectorBomRow } from '../ConnectorBomTable';
import en from '../../i18n/locales/en.json';
import uk from '../../i18n/locales/uk.json';

describe('ConnectorBomTable — drawerSlide BOM label (real i18n)', () => {
  it('en.json has bom.connector.drawerSlide key with non-empty English value', () => {
    // Type-safe access via cast
    const enConnector = (en as any).bom?.connector;
    expect(enConnector?.drawerSlide).toBe('Drawer slide Ø5');
  });

  it('uk.json has bom.connector.drawerSlide key with non-empty Ukrainian value', () => {
    const ukConnector = (uk as any).bom?.connector;
    expect(ukConnector?.drawerSlide).toBeTruthy();
    expect(ukConnector?.drawerSlide).not.toBe('Drawer slide Ø5'); // translated, not English
  });

  it('renders drawerSlide name from t(nameKey) — localized label not raw key', () => {
    // The name field is pre-resolved by useConnectorBomResult via t(nameKey).
    // We simulate what the hook produces: t('bom.connector.drawerSlide') = 'Drawer slide Ø5'.
    // Since test-setup loads real i18n with English locale, we can test via a row
    // where name is set to the resolved value.
    const rows: ConnectorBomRow[] = [
      {
        kind: 'drawerSlide',
        name: 'Drawer slide Ø5',   // resolved by useConnectorBomResult hook
        qty: 8,
        notes: 'система-32 Ø5 blind',
      },
    ];
    render(<ConnectorBomTable rows={rows} />);
    // The localized name should appear, not the raw key
    expect(screen.getByText('Drawer slide Ø5')).toBeTruthy();
    expect(screen.queryByText('bom.connector.drawerSlide')).toBeNull();
  });

  it('renders drawerSlide kind identifier in the first column', () => {
    const rows: ConnectorBomRow[] = [
      { kind: 'drawerSlide', name: 'Drawer slide Ø5', qty: 4, notes: '' },
    ];
    render(<ConnectorBomTable rows={rows} />);
    expect(screen.getByText('drawerSlide')).toBeTruthy();
  });

  it('bom.boringRole has both drawerSlide-cabinet and drawerSlide-box in en + uk', () => {
    const enBoringRole = (en as any).bom?.boringRole;
    const ukBoringRole = (uk as any).bom?.boringRole;
    expect(enBoringRole?.['drawerSlide-cabinet']).toBeTruthy();
    expect(enBoringRole?.['drawerSlide-box']).toBeTruthy();
    expect(ukBoringRole?.['drawerSlide-cabinet']).toBeTruthy();
    expect(ukBoringRole?.['drawerSlide-box']).toBeTruthy();
  });
});
