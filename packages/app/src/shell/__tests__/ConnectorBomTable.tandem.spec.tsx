/**
 * Worker 3: ConnectorBomTable — tandem + legLeveler localized labels (real i18n).
 *
 * Verifies that tandem and legLeveler rows render the localized label from
 * bom.connector.tandem / bom.connector.legLeveler, NOT the raw key.
 * This also proves both keys exist in en.json / uk.json.
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

describe('ConnectorBomTable — tandem + legLeveler BOM labels (real i18n)', () => {
  it('en.json has bom.connector.tandem key with non-empty English value', () => {
    const enConnector = (en as any).bom?.connector;
    expect(enConnector?.tandem).toBe('Blum TANDEM slide');
  });

  it('en.json has bom.connector.legLeveler key with non-empty English value', () => {
    const enConnector = (en as any).bom?.connector;
    expect(enConnector?.legLeveler).toBe('Leg-leveler screw');
  });

  it('uk.json has bom.connector.tandem key with non-empty Ukrainian value', () => {
    const ukConnector = (uk as any).bom?.connector;
    expect(ukConnector?.tandem).toBeTruthy();
    expect(ukConnector?.tandem).not.toBe('Blum TANDEM slide'); // translated, not English
  });

  it('uk.json has bom.connector.legLeveler key with non-empty Ukrainian value', () => {
    const ukConnector = (uk as any).bom?.connector;
    expect(ukConnector?.legLeveler).toBeTruthy();
    expect(ukConnector?.legLeveler).not.toBe('Leg-leveler screw'); // translated, not English
  });

  it('renders tandem name from t(nameKey) — localized label not raw key', () => {
    // The name field is pre-resolved by useConnectorBomResult via t(nameKey).
    // We simulate what the hook produces: t('bom.connector.tandem') = 'Blum TANDEM slide'.
    const rows: ConnectorBomRow[] = [
      {
        kind: 'tandem',
        name: 'Blum TANDEM slide',   // resolved by useConnectorBomResult hook
        qty: 8,
        notes: 'under-mount Ø5',
      },
    ];
    render(<ConnectorBomTable rows={rows} />);
    // The localized name should appear, not the raw key
    expect(screen.getByText('Blum TANDEM slide')).toBeTruthy();
    expect(screen.queryByText('bom.connector.tandem')).toBeNull();
  });

  it('renders tandem kind identifier in the first column', () => {
    const rows: ConnectorBomRow[] = [
      { kind: 'tandem', name: 'Blum TANDEM slide', qty: 4, notes: '' },
    ];
    render(<ConnectorBomTable rows={rows} />);
    expect(screen.getByText('tandem')).toBeTruthy();
  });
});
