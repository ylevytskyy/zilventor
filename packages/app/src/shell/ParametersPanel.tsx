import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';
import { useParameterValues } from '../parameters/useParameterValues';

type Props = {
  registry: ParameterRegistry;
  onClose(): void;
};

export function ParametersPanel({ registry, onClose }: Props) {
  const { t } = useTranslation();
  const values = useParameterValues(registry);
  const [editing, setEditing] = useState<{ name: string; expression: string } | null>(null);
  const params = registry.getAll();

  const commitExpression = (name: string, expression: string): void => {
    const p = registry.getAll().find((x) => x.name === name);
    if (!p) return;
    registry.setParameter({ name, expression, unit: p.unit });
    setEditing(null);
  };

  return (
    <div role="dialog" aria-label={t('panel.parameters.ariaLabel')} style={{
      position: 'fixed', top: '15%', left: '25%', right: '25%',
      background: '#1a1a1a', color: '#eee', border: '1px solid #444',
      borderRadius: 6, padding: 16, zIndex: 60
    }}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('panel.parameters.title')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#aaa' }}>
            <th>{t('panel.parameters.colName')}</th><th>{t('panel.parameters.colExpression')}</th><th>{t('panel.parameters.colValue')}</th><th>{t('panel.parameters.colUnit')}</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} data-testid={`param-row-${p.name}`}>
              <td data-testid={`param-name-${p.name}`}>{p.name}</td>
              <td>
                {editing?.name === p.name ? (
                  <input
                    autoFocus
                    value={editing.expression}
                    onChange={(e) => setEditing({ name: p.name, expression: e.target.value })}
                    onBlur={() => commitExpression(p.name, editing.expression)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitExpression(p.name, editing.expression);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <span data-testid={`param-expression-${p.name}`} onDoubleClick={() => setEditing({ name: p.name, expression: p.expression })}>{p.expression}</span>
                )}
              </td>
              <td data-testid={`param-value-${p.name}`}>{values.get(p.name) ?? '?'}</td>
              <td>{p.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <button onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}
