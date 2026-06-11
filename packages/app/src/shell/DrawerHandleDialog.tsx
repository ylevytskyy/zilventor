import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 280, color: '#eee', fontSize: 12,
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6,
};
const fieldStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444', fontSize: 11,
  padding: '2px 4px', width: 130,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function DrawerHandleDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const dialog = useAppStore((s) => s.addDrawerHandleDialog);
  const setDialog = useAppStore((s) => s.setAddDrawerHandleDialog);

  const [cc, setCc] = React.useState<96 | 128 | 160>(96);

  // Reset default each time the dialog opens.
  React.useEffect(() => {
    if (dialog) {
      setCc(96);
    }
  }, [dialog]);

  if (!dialog) return null;

  const handleApply = (): void => {
    dialog.onSubmit(cc);
    setDialog(null);
  };

  const handleCancel = (): void => {
    dialog.onCancel();
    setDialog(null);
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div
        style={panelStyle}
        role="dialog"
        aria-label={t('aria.add_handles_dialog', 'Add Handles dialog')}
        onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('dialog.drawerHandle.title', 'Add Drawer Handles')}</div>

        <div style={rowStyle}>
          <label htmlFor="drawerhandle-cc">{t('dialog.drawerHandle.cc', 'Center-to-center')}</label>
          <select
            id="drawerhandle-cc"
            aria-label={t('dialog.drawerHandle.cc', 'Center-to-center')}
            style={fieldStyle}
            value={cc}
            onChange={(e) => setCc(Number(e.target.value) as 96 | 128 | 160)}
          >
            <option value={96}>{t('dialog.drawerHandle.cc96', '96 mm')}</option>
            <option value={128}>{t('dialog.drawerHandle.cc128', '128 mm')}</option>
            <option value={160}>{t('dialog.drawerHandle.cc160', '160 mm')}</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>{t('common.cancel', 'Cancel')}</button>
          <button style={okBtnStyle} onClick={handleApply}>{t('common.apply', 'Apply')}</button>
        </div>
      </div>
    </div>
  );
}
