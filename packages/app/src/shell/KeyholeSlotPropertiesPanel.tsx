import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { KeyholeSlotFeature, KeyholeSlotSpec, Feature } from '@zilventor/shared';
import { EditKeyholeSlotCommand } from '../commands/EditKeyholeSlotCommand';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

export interface Props {
  /** Returns the LIVE keyhole-slot array for a given partPath (mirrors getLiveGrooves). */
  getLiveKeyholeSlots: (partPath: string) => KeyholeSlotFeature[] | undefined;
  /** Returns the LIVE PartDocument-like object (its featureTree) for a given partPath. */
  getLiveDoc: (partPath: string) => { featureTree?: Feature[] } | null;
  opfs?: OpfsRW | null;
}

/**
 * Inline-editable keyhole-slot-parameter panel for the currently-selected
 * keyhole slot (1:1 port of GroovePropertiesPanel, minus the preset-picker
 * block — see S1 scope call: toolNumber/speed/presetLayerName stay read-only
 * rows since ApplyMachiningPresetCommand has no 'keyholeSlot' branch yet).
 *
 * faceRole/u/v/axis/direction/entryDiameter/slotWidth/slotLength/depth are
 * editable; every commit dispatches via `bus.execute()` so edits are
 * undoable.
 */
export function KeyholeSlotPropertiesPanel({ getLiveKeyholeSlots, getLiveDoc, opfs = null }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const selectedKeyholeSlotId = useAppStore((s) => s.selectedKeyholeSlotId);
  const selectedKeyholeSlotPartPath = useAppStore((s) => s.selectedKeyholeSlotPartPath);
  const bus = useAppStore((s) => s.bus);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const resetDraft = useCallback(() => setDraft({}), []);

  const keyholeSlot = selectedKeyholeSlotId && selectedKeyholeSlotPartPath
    ? (getLiveKeyholeSlots(selectedKeyholeSlotPartPath) ?? []).find((k) => k.id === selectedKeyholeSlotId) ?? null
    : null;

  if (!keyholeSlot || !selectedKeyholeSlotPartPath) return null;

  type EditableField = 'faceRole' | 'u' | 'v' | 'axis' | 'direction' | 'entryDiameter' | 'slotWidth' | 'slotLength' | 'depth';
  type NumField = 'u' | 'v' | 'entryDiameter' | 'slotWidth' | 'slotLength' | 'depth';

  function commitPatch(patch: Partial<Pick<KeyholeSlotSpec, EditableField>>) {
    const liveDoc = getLiveDoc(selectedKeyholeSlotPartPath!);
    if (!liveDoc) return;
    const liveKeyholeSlot = (getLiveKeyholeSlots(selectedKeyholeSlotPartPath!) ?? []).find((k) => k.id === selectedKeyholeSlotId);
    if (!liveKeyholeSlot) return;
    void bus.execute(new EditKeyholeSlotCommand({
      keyholeSlot: liveKeyholeSlot,
      patch,
      partPath: selectedKeyholeSlotPartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
  }

  function val(field: NumField): string {
    if (field in draft) return draft[field]!;
    return String(keyholeSlot![field]);
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

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #333', fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#ccc' }}>
        {t('common.keyholeSlot_properties')}
      </div>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{t('dialog.keyholeSlot.face')}</span>
        <select
          aria-label={t('dialog.keyholeSlot.face')}
          value={keyholeSlot.faceRole}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => commitPatch({ faceRole: e.target.value as KeyholeSlotSpec['faceRole'] })}
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
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{t('dialog.keyholeSlot.axis')}</span>
        <select
          aria-label={t('dialog.keyholeSlot.axis')}
          value={keyholeSlot.axis}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => commitPatch({ axis: e.target.value as KeyholeSlotSpec['axis'] })}
        >
          <option value="u">u</option>
          <option value="v">v</option>
        </select>
      </label>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2 }}>
        <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>{t('dialog.keyholeSlot.direction')}</span>
        <select
          aria-label={t('dialog.keyholeSlot.direction')}
          value={String(keyholeSlot.direction)}
          style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
          onChange={(e) => commitPatch({ direction: Number(e.target.value) as 1 | -1 })}
        >
          <option value="1">+1</option>
          <option value="-1">-1</option>
        </select>
      </label>
      {numericInput('u', t('dialog.keyholeSlot.u'))}
      {numericInput('v', t('dialog.keyholeSlot.v'))}
      {numericInput('entryDiameter', t('dialog.keyholeSlot.entryDiameter'))}
      {numericInput('slotWidth', t('dialog.keyholeSlot.slotWidth'))}
      {numericInput('slotLength', t('dialog.keyholeSlot.slotLength'))}
      {numericInput('depth', t('dialog.keyholeSlot.depth'))}
      <div style={{ color: '#aaa', marginBottom: 2 }}>{t('groove.tool_number')}: {keyholeSlot.toolNumber ?? '—'}</div>
      <div style={{ color: '#aaa', marginBottom: 2 }}>{t('groove.speed_rpm')}: {keyholeSlot.speed ?? '—'}</div>
      <div style={{ color: '#aaa', marginBottom: 4 }}>{t('groove.layer_name')}: {keyholeSlot.presetLayerName ?? '—'}</div>
    </div>
  );
}
