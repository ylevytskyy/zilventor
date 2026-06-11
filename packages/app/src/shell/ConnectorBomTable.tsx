import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BoreConnectorKind } from '@zilventor/shared';

/** Display row — name is already i18n-resolved by useConnectorBomResult. */
export interface ConnectorBomRow {
  kind: BoreConnectorKind;
  name: string;    // resolved via t(nameKey) by the hook
  qty: number;
  notes: string;
}

interface Props {
  rows: ConnectorBomRow[];
}

export function ConnectorBomTable({ rows }: Props): JSX.Element {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>{t('common.no_connectors')}</div>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>{t('common.connectors')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {[t('table.connector.type'), t('table.connector.name'), t('table.connector.qty'), t('table.connector.notes')].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '2px 4px', color: '#aaa' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.kind}</td>
              <td style={{ padding: '2px 4px' }}>{r.name}</td>
              <td style={{ padding: '2px 4px', textAlign: 'right' }}>{r.qty}</td>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.notes || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
