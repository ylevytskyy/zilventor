import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { LabelHeaderPreset } from '../store/labelHeaderPreset';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 480, color: '#eee', fontSize: 12, maxHeight: '90vh', overflowY: 'auto',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 11, background: '#2a2a2a', color: '#eee',
  border: '1px solid #555', borderRadius: 2, padding: '2px 4px',
};

type FormState = {
  name: string;
  line1: string;
  line2: string;
};

const emptyForm: FormState = { name: '', line1: '', line2: '' };

function presetToForm(p: LabelHeaderPreset): FormState {
  return { name: p.name, line1: p.line1, line2: p.line2 };
}

export function LabelHeaderPresetsDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.labelHeaderPresetsDialogOpen);
  const presets = useAppStore((s) => s.labelHeaderPresets);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm);

  React.useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setForm(emptyForm);
  }, [open]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) useAppStore.getState().toggleLabelHeaderPresetsDialog(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const close = () => useAppStore.getState().toggleLabelHeaderPresetsDialog(false);

  const startEdit = (p: LabelHeaderPreset) => {
    setEditingId(p.id);
    setForm(presetToForm(p));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;

    const preset: LabelHeaderPreset = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name,
      line1: form.line1,
      line2: form.line2,
    };

    if (editingId) {
      useAppStore.getState().updateLabelHeaderPreset(preset);
    } else {
      useAppStore.getState().addLabelHeaderPreset(preset);
    }
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = (id: string) => {
    useAppStore.getState().deleteLabelHeaderPreset(id);
    if (editingId === id) {
      setEditingId(null);
      setForm(emptyForm);
    }
  };

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-label={t('aria.labelHeaderPresets')}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('dialog.labelHeaderPresets.title')}</div>

        <div style={{ marginBottom: 12 }}>
          {presets.length === 0 && (
            <div style={{ color: '#888', marginBottom: 8 }}>{t('dialog.labelHeaderPresets.empty')}</div>
          )}
          {presets.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, borderBottom: '1px solid #333', paddingBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: '#888', marginLeft: 8 }}>
                  {p.line1}
                  {p.line2 ? ` · ${p.line2}` : ''}
                </span>
              </div>
              <button type="button" style={btnStyle} onClick={() => startEdit(p)} aria-label={t('common.edit')}>
                {t('common.edit')}
              </button>
              <button type="button" style={btnStyle} onClick={() => handleDelete(p.id)} aria-label={t('common.delete')}>
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.labelHeaderPresets.name')}</div>
            <input
              aria-label={t('dialog.labelHeaderPresets.name')}
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.labelHeaderPresets.line1')}</div>
            <input
              aria-label={t('dialog.labelHeaderPresets.line1')}
              style={inputStyle}
              value={form.line1}
              onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.labelHeaderPresets.line2')}</div>
            <input
              aria-label={t('dialog.labelHeaderPresets.line2')}
              style={inputStyle}
              value={form.line2}
              onChange={(e) => setForm((f) => ({ ...f, line2: e.target.value }))}
            />
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <button type="button" style={okBtnStyle} onClick={handleSubmit} aria-label={editingId ? t('common.save') : t('common.add')}>
            {editingId ? t('common.save') : t('common.add')}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" style={btnStyle} onClick={close} aria-label={t('common.close')}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
