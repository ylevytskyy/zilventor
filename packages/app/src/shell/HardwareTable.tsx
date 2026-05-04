import React from 'react';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

interface Props {
  rows: HardwareRow[];
}

export function HardwareTable({ rows }: Props): JSX.Element {
  if (rows.length === 0) {
    return <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>No hardware</div>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Hardware</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {['SKU', 'Name', 'Category', 'Qty', 'Notes'].map((h) => (
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
