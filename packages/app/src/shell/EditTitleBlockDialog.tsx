import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import { EditTitleBlockCommand } from '../commands/EditTitleBlockCommand';
import type { TitleBlockOverrides } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 420, color: '#eee', fontSize: 12,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 };
const labelStyle: React.CSSProperties = { width: 110, fontSize: 11, flexShrink: 0 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };
const errorStyle: React.CSSProperties = { color: '#ff6b6b', fontSize: 11, marginBottom: 6 };

type DialogState = { sheetId: string; initialOverrides: TitleBlockOverrides };

const FIELDS: Array<{ key: keyof TitleBlockOverrides; label: string; multiline?: boolean }> = [
  { key: 'drawingName',  label: 'Drawing name' },
  { key: 'partName',     label: 'Part name' },
  { key: 'drawnBy',      label: 'Drawn by' },
  { key: 'approvedBy',   label: 'Approved by' },
  { key: 'scaleText',    label: 'Scale' },
  { key: 'date',         label: 'Date' },
  { key: 'material',     label: 'Material' },
  { key: 'revision',     label: 'Revision' },
  { key: 'notes',        label: 'Notes', multiline: true },
];

export function EditTitleBlockDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const state = useAppStore((s) => (s as any).editTitleBlockDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);

  const [values, setValues] = React.useState<Partial<Record<keyof TitleBlockOverrides, string>>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state) {
      const init: Partial<Record<keyof TitleBlockOverrides, string>> = {};
      for (const { key } of FIELDS) {
        init[key] = (state.initialOverrides[key] as string | undefined) ?? '';
      }
      setValues(init);
    }
  }, [state]);

  if (!state) return null;

  const close = () => useAppStore.setState({ editTitleBlockDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    const overrides: TitleBlockOverrides = {};
    for (const { key } of FIELDS) {
      const v = values[key];
      if (v && v.trim()) (overrides as Record<string, string>)[key] = v.trim();
    }
    setError(null);
    try {
      await bus.execute(new EditTitleBlockCommand({ sheetId: state.sheetId, overrides }));
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label={t('aria.edit_title_block')}
        onKeyDown={(e) => { if (e.key === 'Escape') close(); }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('dialog.titleBlock.title')}</div>
        {FIELDS.map(({ key, label, multiline }) => (
          <div key={key} style={fieldRow}>
            <label style={labelStyle} htmlFor={`tb-${key}`}>{label}</label>
            {multiline ? (
              <textarea
                id={`tb-${key}`}
                aria-label={label}
                style={{ ...inputStyle, height: 48, resize: 'vertical' }}
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            ) : (
              <input
                id={`tb-${key}`}
                aria-label={label}
                type="text"
                style={inputStyle}
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            )}
          </div>
        ))}
        {error && (
          <div style={errorStyle} role="alert">{error}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={btnStyle} onClick={close}>{t('common.cancel')}</button>
          <button style={okBtnStyle} onClick={() => { void handleOk(); }}>{t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
