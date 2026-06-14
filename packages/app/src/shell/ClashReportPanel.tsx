import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ClashReportRow } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';

interface Props {
  rows: ClashReportRow[] | null;
  ran: boolean;
  onRowClick: (aPath: ComponentPath, bPath: ComponentPath, aKey: string, bKey: string) => void;
}

export function ClashReportPanel({ rows, ran, onRowClick }: Props): JSX.Element {
  const { t } = useTranslation();

  if (!ran) {
    return (
      <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>
        {t('clash.never_run')}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>
        <div>{t('clash.no_results')}</div>
        <div style={{ color: '#666', marginTop: 4 }}>{t('clash.carcass_noise_disclaimer')}</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>
        {t('clash.panel_title')}
      </div>
      <div style={{ color: '#666', fontSize: 10, marginBottom: 4 }}>{t('clash.carcass_noise_disclaimer')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {[
              t('clash.kind_interference') + '/' + t('clash.kind_clearance'),
              t('clash.part_a'),
              t('clash.part_b'),
              t('clash.volume_label') + ' / ' + t('clash.distance_label'),
            ].map((h) => (
              <th
                key={h}
                style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '2px 4px', color: '#aaa' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.aPathKey}__${row.bPathKey}__${idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onRowClick(row.aPath, row.bPath, row.aPathKey, row.bPathKey)}
            >
              <td style={{ padding: '2px 4px', color: row.kind === 'interference' ? '#ff4444' : '#ffaa44' }}>
                {row.kind === 'interference' ? t('clash.kind_interference') : t('clash.kind_clearance')}
              </td>
              <td style={{ padding: '2px 4px' }}>{row.aName}</td>
              <td style={{ padding: '2px 4px' }}>{row.bName}</td>
              <td style={{ padding: '2px 4px', color: '#888' }}>
                {row.kind === 'interference'
                  ? row.volume?.toFixed(0) ?? '—'
                  : row.distance?.toFixed(2) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
