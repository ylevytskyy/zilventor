import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

interface Props {
  rows: HardwareRow[];
}

export function HardwareTable({ rows }: Props): JSX.Element {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>{t('common.no_hardware')}</div>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>{t('common.hardware')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {[t('table.hardware.sku'), t('table.hardware.name'), t('table.hardware.category'), t('table.hardware.qty'), t('table.hardware.notes')].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '2px 4px', color: '#aaa' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skuId}>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.skuId}</td>
              <td style={{ padding: '2px 4px' }}>{r.name}</td>
              <td style={{ padding: '2px 4px', color: '#aaa' }}>{r.category}</td>
              <td style={{ padding: '2px 4px', textAlign: 'right' }}>{r.qty}</td>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.notes || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
