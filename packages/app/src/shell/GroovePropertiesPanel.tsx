import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { GrooveFeature, GrooveSpec, Feature } from '@zilventor/shared';
import { ApplyMachiningPresetCommand } from '../commands/ApplyMachiningPresetCommand';
import { EditGrooveCommand } from '../commands/EditGrooveCommand';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

interface Props {
  /** Returns the LIVE groove array for a given partPath (mirrors getLiveBores). */
  getLiveGrooves: (partPath: string) => GrooveFeature[] | undefined;
  /** Returns the LIVE PartDocument-like object (its featureTree) for a given partPath. */
  getLiveDoc: (partPath: string) => { featureTree?: Feature[] } | null;
  opfs?: OpfsRW | null;
}

/**
 * Inline-editable groove-parameter panel + machining-preset apply control for
 * the currently-selected groove. faceRole/axis/position/width/depth are
 * editable (P14); toolNumber/speed/presetLayerName stay read-only rows —
 * those are preset-owned (see D4 in
 * docs/superpowers/plans/2026-07-03-p9-preset-coverage.md).
 *
 * Unlike BorePropertiesPanel's pre-existing preset-apply path (a direct
 * `.apply()` bypass), this panel dispatches via `bus.execute()` so both the
 * preset apply and every field edit are undoable (D8).
 */
export function GroovePropertiesPanel({ getLiveGrooves, getLiveDoc, opfs = null }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const selectedGrooveId = useAppStore((s) => s.selectedGrooveId);
  const selectedGroovePartPath = useAppStore((s) => s.selectedGroovePartPath);
  const bus = useAppStore((s) => s.bus);
  const machiningPresets = useAppStore((s) => s.machiningPresets);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const resetDraft = useCallback(() => setDraft({}), []);

  const groove = selectedGrooveId && selectedGroovePartPath
    ? (getLiveGrooves(selectedGroovePartPath) ?? []).find((g) => g.id === selectedGrooveId) ?? null
    : null;

  if (!groove || !selectedGroovePartPath) return null;

  const matchingPresets = machiningPresets.filter((p) => p.opType === 'groove');

  type EditableField = 'faceRole' | 'axis' | 'position' | 'width' | 'depth';
  type NumField = 'position' | 'width' | 'depth';

  function commitPatch(patch: Partial<Pick<GrooveSpec, EditableField>>) {
    const liveDoc = getLiveDoc(selectedGroovePartPath!);
    if (!liveDoc) return;
    const liveGroove = (getLiveGrooves(selectedGroovePartPath!) ?? []).find((g) => g.id === selectedGrooveId);
    if (!liveGroove) return;
    void bus.execute(new EditGrooveCommand({
      groove: liveGroove,
      patch,
      partPath: selectedGroovePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
  }

  function val(field: NumField): string {
    if (field in draft) return draft[field]!;
    return String(groove![field]);
  }

  function commitField(field: NumField) {
    if (!(field in draft)) return;
    const num = parseFloat(draft[field]!);
    if (!isFinite(num)) { resetDraft(); return; }
    commitPatch({ [field]: num });
    resetDraft();
  }

  function onKeyDown(field: NumField, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { commitField(field); }
    if (e.key === 'Escape') { resetDraft(); }
  }

  function numericInput(field: NumField, label: string) {
    return (
      <label key={field} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{label}</span>
        <input
          type="number"
          value={val(field)}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
          onKeyDown={(e) => onKeyDown(field, e)}
          onBlur={() => commitField(field)}
        />
      </label>
    );
  }

  function applyPreset() {
    const preset = matchingPresets.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const liveDoc = getLiveDoc(selectedGroovePartPath!);
    if (!liveDoc) return;
    const liveGroove = (getLiveGrooves(selectedGroovePartPath!) ?? []).find((g) => g.id === selectedGrooveId);
    if (!liveGroove) return;
    void bus.execute(new ApplyMachiningPresetCommand({
      groove: liveGroove,
      values: {
        layerName: preset.layerName,
        ...(preset.toolNumber === undefined ? {} : { toolNumber: preset.toolNumber }),
        ...(preset.speed === undefined ? {} : { speed: preset.speed }),
      },
      partPath: selectedGroovePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
  }

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #333', fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#ccc' }}>
        {t('common.groove_properties')}
      </div>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{t('dialog.groove.face')}</span>
        <select
          aria-label={t('dialog.groove.face')}
          value={groove.faceRole}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => commitPatch({ faceRole: e.target.value as GrooveSpec['faceRole'] })}
        >
          <option value="Top">Top</option>
          <option value="Bottom">Bottom</option>
          <option value="Front">Front</option>
          <option value="Back">Back</option>
          <option value="Left">Left</option>
          <option value="Right">Right</option>
        </select>
      </label>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{t('groove.axis')}</span>
        <select
          aria-label={t('groove.axis')}
          value={groove.axis}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => commitPatch({ axis: e.target.value as GrooveSpec['axis'] })}
        >
          <option value="u">u</option>
          <option value="v">v</option>
        </select>
      </label>
      {numericInput('position', t('groove.position_mm'))}
      {numericInput('width', t('groove.width_mm'))}
      {numericInput('depth', t('aria.depth'))}
      <div style={{ color: '#aaa', marginBottom: 2 }}>{t('groove.tool_number')}: {groove.toolNumber ?? '—'}</div>
      <div style={{ color: '#aaa', marginBottom: 2 }}>{t('groove.speed_rpm')}: {groove.speed ?? '—'}</div>
      <div style={{ color: '#aaa', marginBottom: 4 }}>{t('groove.layer_name')}: {groove.presetLayerName ?? '—'}</div>
      {matchingPresets.length > 0 && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>
            {t('bore.machining_preset')}
          </span>
          <select
            aria-label={t('bore.machining_preset')}
            value={selectedPresetId}
            style={{ width: 120, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
            onChange={(e) => setSelectedPresetId(e.target.value)}
          >
            <option value="" />
            {matchingPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyPreset}
            disabled={!selectedPresetId}
            style={{ fontSize: 11, padding: '1px 8px', background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, cursor: 'pointer' }}
          >
            {t('common.apply')}
          </button>
        </label>
      )}
    </div>
  );
}
