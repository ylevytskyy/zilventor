import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Configuration } from '@zilventor/shared';
import { parseConfigurationsCsv } from '../configurations/parseConfigurationsCsv';

type Props = {
  configurations: Configuration[];
  activeName: string | null;
  onActivate(name: string): void;
  onAddRow(): void;
  onImport(configs: Configuration[]): void;
  onClose(): void;
};

/**
 * Row-picker UI for iPart configurations (design table). Each configuration is a
 * clickable row that activates it (bulk-sets its parameters); the active row is
 * highlighted. "Add Row" clones the current design state into a new configuration;
 * "Import CSV" replaces the table from a design-table CSV.
 */
export function ConfigurationsPanel({
  configurations,
  activeName,
  onActivate,
  onAddRow,
  onImport,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    const text = await file.text();
    onImport(parseConfigurationsCsv(text));
  };

  return (
    <div role="dialog" aria-label={t('panel.configurations.ariaLabel')} style={{
      position: 'fixed', top: '15%', left: '25%', right: '25%',
      background: '#1a1a1a', color: '#eee', border: '1px solid #444',
      borderRadius: 6, padding: 16, zIndex: 60
    }}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('panel.configurations.title')}</div>
      {configurations.length === 0 ? (
        <div style={{ color: '#aaa', marginBottom: 12 }}>{t('panel.configurations.empty')}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#aaa' }}>
              <th>{t('panel.configurations.colName')}</th>
              <th>{t('panel.configurations.colValues')}</th>
            </tr>
          </thead>
          <tbody>
            {configurations.map((c) => {
              const active = c.name === activeName;
              return (
                <tr
                  key={c.name}
                  data-testid={`config-row-${c.name}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onActivate(c.name)}
                  style={{ cursor: 'pointer', background: active ? '#2d4a2d' : undefined }}
                >
                  <td>{c.name}</td>
                  <td style={{ color: '#aaa' }}>
                    {Object.entries(c.values).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button data-testid="config-add-row" onClick={onAddRow}>{t('panel.configurations.addRow')}</button>
        <button data-testid="config-import-csv" onClick={() => fileRef.current?.click()}>
          {t('panel.configurations.importCsv')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          data-testid="config-csv-input"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}
