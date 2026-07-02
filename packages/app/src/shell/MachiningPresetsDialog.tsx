import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import {
  validateMachiningPresetImport,
  serializeMachiningPresets,
} from '@zilventor/shared/src/machiningPreset';
import type { MachiningPreset } from '@zilventor/shared';
import { pickFile, saveBlob } from './fsaFallback';

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

const OP_TYPES: readonly string[] = [
  'confirmat-face', 'confirmat-edge',
  'minifix-cam', 'minifix-bolt', 'minifix-cross',
  'dowel-face', 'dowel-edge',
  'shelfPin-system32',
  'hingeCup',
  'hingePlate',
  'drawerSlide-cabinet',
  'drawerSlide-box',
  'handleScrew-face',
  'legLeveler',
  'tandem-cabinet',
  'tandem-drawer-bottom',
  'tandem-drawer-back',
  'groove',
];

type FormState = {
  name: string;
  opType: string;
  diameter: string;
  depth: string;
  offset: string;
  layerName: string;
  toolNumber: string;
  speed: string;
};

const emptyForm: FormState = {
  name: '', opType: OP_TYPES[0]!, diameter: '', depth: '',
  offset: '', layerName: '', toolNumber: '', speed: '',
};

function presetToForm(p: MachiningPreset): FormState {
  return {
    name: p.name,
    opType: p.opType,
    diameter: String(p.diameter),
    depth: String(p.depth),
    offset: p.offset === undefined ? '' : String(p.offset),
    layerName: p.layerName,
    toolNumber: p.toolNumber === undefined ? '' : String(p.toolNumber),
    speed: p.speed === undefined ? '' : String(p.speed),
  };
}

export function MachiningPresetsDialog(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useAppStore((s) => s.machiningPresetsDialogOpen);
  const presets = useAppStore((s) => s.machiningPresets);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [importError, setImportError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setForm(emptyForm);
    setImportError(null);
  }, [open]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) useAppStore.getState().toggleMachiningPresetsDialog(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const close = () => useAppStore.getState().toggleMachiningPresetsDialog(false);

  const startEdit = (p: MachiningPreset) => {
    setEditingId(p.id);
    setForm(presetToForm(p));
  };

  const handleSubmit = () => {
    const diameter = Number(form.diameter);
    const depth = Number(form.depth);
    if (!form.name.trim() || !form.layerName.trim() || !Number.isFinite(diameter) || !Number.isFinite(depth)) return;

    const preset: MachiningPreset = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name,
      opType: form.opType as MachiningPreset['opType'],
      diameter,
      depth,
      layerName: form.layerName,
      ...(form.offset.trim() === '' ? {} : { offset: Number(form.offset) }),
      ...(form.toolNumber.trim() === '' ? {} : { toolNumber: Number(form.toolNumber) }),
      ...(form.speed.trim() === '' ? {} : { speed: Number(form.speed) }),
    };

    if (editingId) {
      useAppStore.getState().updateMachiningPreset(preset);
    } else {
      useAppStore.getState().addMachiningPreset(preset);
    }
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleDelete = (id: string) => {
    useAppStore.getState().deleteMachiningPreset(id);
    if (editingId === id) {
      setEditingId(null);
      setForm(emptyForm);
    }
  };

  const handleImport = async () => {
    const file = await pickFile([{ accept: { 'application/json': ['.json'] }, description: 'JSON' }]);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const existingIds = new Set(useAppStore.getState().machiningPresets.map((p) => p.id));
      const result = validateMachiningPresetImport(parsed, existingIds);
      useAppStore.getState().importMachiningPresets(result);
      setImportError(null);
    } catch (e) {
      setImportError(t('dialog.machiningPresets.import.error', { message: (e as Error).message }));
    }
  };

  const handleExport = async () => {
    const json = serializeMachiningPresets(presets);
    const blob = new Blob([json], { type: 'application/json' });
    await saveBlob(blob, 'machining-presets.json', [{ accept: { 'application/json': ['.json'] }, description: 'JSON' }]);
  };

  return (
    <div style={overlayStyle} onClick={close} role="dialog" aria-label={t('aria.machiningPresets')}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('dialog.machiningPresets.title')}</div>

        <div style={{ marginBottom: 12 }}>
          {presets.length === 0 && (
            <div style={{ color: '#888', marginBottom: 8 }}>{t('dialog.machiningPresets.empty')}</div>
          )}
          {presets.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, borderBottom: '1px solid #333', paddingBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: '#888', marginLeft: 8 }}>
                  {p.opType} · Ø{p.diameter}×{p.depth}mm · {p.layerName}
                  {p.toolNumber !== undefined ? ` · T${p.toolNumber}` : ''}
                  {p.speed !== undefined ? ` · ${p.speed}rpm` : ''}
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
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.name')}</div>
            <input
              aria-label={t('dialog.machiningPresets.name')}
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.opType')}</div>
            <select
              aria-label={t('dialog.machiningPresets.opType')}
              style={inputStyle}
              value={form.opType}
              onChange={(e) => setForm((f) => ({ ...f, opType: e.target.value }))}
            >
              {OP_TYPES.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.diameter')}</div>
            <input
              type="number"
              aria-label={t('dialog.machiningPresets.diameter')}
              style={inputStyle}
              value={form.diameter}
              onChange={(e) => setForm((f) => ({ ...f, diameter: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.depth')}</div>
            <input
              type="number"
              aria-label={t('dialog.machiningPresets.depth')}
              style={inputStyle}
              value={form.depth}
              onChange={(e) => setForm((f) => ({ ...f, depth: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.offset')}</div>
            <input
              type="number"
              aria-label={t('dialog.machiningPresets.offset')}
              style={inputStyle}
              value={form.offset}
              onChange={(e) => setForm((f) => ({ ...f, offset: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.layerName')}</div>
            <input
              aria-label={t('dialog.machiningPresets.layerName')}
              style={inputStyle}
              value={form.layerName}
              onChange={(e) => setForm((f) => ({ ...f, layerName: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.toolNumber')}</div>
            <input
              type="number"
              aria-label={t('dialog.machiningPresets.toolNumber')}
              style={inputStyle}
              value={form.toolNumber}
              onChange={(e) => setForm((f) => ({ ...f, toolNumber: e.target.value }))}
            />
          </label>
          <label>
            <div style={{ color: '#aaa', marginBottom: 2 }}>{t('dialog.machiningPresets.speed')}</div>
            <input
              type="number"
              aria-label={t('dialog.machiningPresets.speed')}
              style={inputStyle}
              value={form.speed}
              onChange={(e) => setForm((f) => ({ ...f, speed: e.target.value }))}
            />
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <button type="button" style={okBtnStyle} onClick={handleSubmit} aria-label={editingId ? t('common.save') : t('dialog.machiningPresets.addBtn')}>
            {editingId ? t('common.save') : t('dialog.machiningPresets.addBtn')}
          </button>
        </div>

        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={btnStyle}
            onClick={() => { void handleImport(); }}
            aria-label={t('dialog.machiningPresets.import.button')}
          >
            {t('dialog.machiningPresets.import.button')}
          </button>
          <button
            type="button"
            style={btnStyle}
            onClick={() => { void handleExport(); }}
            aria-label={t('dialog.machiningPresets.export.button')}
          >
            {t('dialog.machiningPresets.export.button')}
          </button>
          {importError && (
            <div role="alert" style={{ color: '#f88', fontSize: 11 }}>
              {importError}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" style={btnStyle} onClick={close} aria-label={t('common.close')}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
