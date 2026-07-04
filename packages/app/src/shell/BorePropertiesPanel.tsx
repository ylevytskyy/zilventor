import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { BoreOp, ShelfPinParams } from '@zilventor/shared';
import { DEFAULT_SHELF_PIN_PARAMS } from '@zilventor/shared';
import { rotate } from '@zilventor/shared/src/jointMath';
import { EditBoreCommand } from '../commands/EditBoreCommand';
import { ApplyMachiningPresetCommand } from '../commands/ApplyMachiningPresetCommand';
import { DeleteConnectorCommand } from '../commands/DeleteConnectorCommand';
import { MoveConnectorCommand } from '../commands/MoveConnectorCommand';
import { UpdateShelfPinStartOffsetCommand } from '../commands/UpdateShelfPinStartOffsetCommand';
import { FlipBoreFaceCommand } from '../commands/FlipBoreFaceCommand';
import { collectConnectorMembers } from './collectConnectorMembers';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

type ConnectorDocEntry = {
  partPath: string;
  doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] };
  panelDims: { length: number; width: number; thickness: number };
  worldPose: { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };
};

interface Props {
  /**
   * Returns the LIVE bore array for a given partPath — the same array that
   * bore markers are built from (partBoresCacheRef.current.get(partPath)).
   * Called at command-construction time, not at render time, so commands
   * always receive the current state.
   */
  getLiveBores: (partPath: string) => BoreOp[] | undefined;
  /**
   * Returns the LIVE PartDocument-like object for a given partPath. Commands
   * receive this reference so mutate+persist+boreCacheInvalidator refreshes
   * markers correctly via the same object the cache holds.
   */
  getLiveDoc: (partPath: string) => { bores?: BoreOp[]; suppressedConnectorIds?: string[]; shelfPinParams?: ShelfPinParams } | null;
  /**
   * Returns all loaded member docs with their panel dims and world poses.
   * Called at command-construction time to build the cross-document member list.
   * NOTE: provides one representative pose per partPath (multi-instance limitation — v1).
   */
  getConnectorDocs: () => ConnectorDocEntry[];
  opfs?: OpfsRW | null;
}

/**
 * Renders a numeric-edit panel for the currently-selected bore.
 * Reads selectedBoreId + selectedBorePartPath from the store.
 * Looks up the LIVE bore reference via getLiveBores at render time.
 * Enter commits via EditBoreCommand; Escape cancels.
 *
 * Field edits, preset apply, and delete all dispatch via `bus.execute()` so
 * the EditBoreCommand/ApplyMachiningPresetCommand/DeleteConnectorCommand
 * apply is undoable (D8, ported from GroovePropertiesPanel).
 */
export function BorePropertiesPanel({ getLiveBores, getLiveDoc, getConnectorDocs, opfs = null }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const selectedBoreId = useAppStore((s) => s.selectedBoreId);
  const selectedBorePartPath = useAppStore((s) => s.selectedBorePartPath);
  const bus = useAppStore((s) => s.bus);
  const machiningPresets = useAppStore((s) => s.machiningPresets);

  // Resolve the live bore reference on every render — NOT cached.
  const bore = selectedBoreId && selectedBorePartPath
    ? (getLiveBores(selectedBorePartPath) ?? []).find((b) => b.id === selectedBoreId) ?? null
    : null;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const resetDraft = useCallback(() => setDraft({}), []);
  // Delta fields for along-joint (carcass connectors) and hinge-height moves.
  // Defined before the early return to satisfy React hooks ordering rules.
  // Both reset to 0 after each commit — they represent a relative delta, not an absolute value.
  const [jointDelta, setJointDelta] = useState('0');
  const [hingeDelta, setHingeDelta] = useState('0');
  // 1a.4 column start offset: null = show persisted value; string = user is editing.
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null);
  // W4: machining preset picker (snapshot-on-apply, ADR 0001).
  const [selectedPresetId, setSelectedPresetId] = useState('');

  if (!bore || !selectedBorePartPath) return null;

  const matchingPresets = machiningPresets.filter((p) => p.opType === bore.role);

  function applyPreset() {
    const preset = matchingPresets.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const liveDoc = getLiveDoc(selectedBorePartPath!);
    if (!liveDoc) return;
    const liveBore = (liveDoc.bores ?? []).find((b) => b.id === selectedBoreId);
    if (!liveBore) return;
    void bus.execute(new ApplyMachiningPresetCommand({
      bore: liveBore,
      values: {
        diameter: preset.diameter,
        depth: preset.depth,
        layerName: preset.layerName,
        ...(preset.toolNumber === undefined ? {} : { toolNumber: preset.toolNumber }),
        ...(preset.speed === undefined ? {} : { speed: preset.speed }),
      },
      partPath: selectedBorePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
  }

  function val(field: keyof Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>): string {
    if (field in draft) return draft[field]!;
    const v = bore![field];
    return v === 'throughAll' ? 'throughAll' : String(v);
  }

  function commitField(field: keyof Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>) {
    if (!(field in draft)) return;
    const rawVal = draft[field]!;
    // Re-fetch the live doc at commit time (not at render time).
    const liveDoc = getLiveDoc(selectedBorePartPath!);
    if (!liveDoc) { resetDraft(); return; }
    // Re-fetch the live bore reference at commit time.
    const liveBore = (liveDoc.bores ?? []).find((b) => b.id === selectedBoreId);
    if (!liveBore) { resetDraft(); return; }

    let patch: Partial<Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>>;
    if (rawVal === 'throughAll' && field === 'depth') {
      patch = { depth: 'throughAll' };
    } else {
      const num = parseFloat(rawVal);
      if (!isFinite(num)) { resetDraft(); return; }
      patch = { [field]: num };
    }
    void bus.execute(new EditBoreCommand({
      bore: liveBore,
      patch,
      partPath: selectedBorePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
    resetDraft();
  }

  function onKeyDown(field: keyof Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { commitField(field); }
    if (e.key === 'Escape') { resetDraft(); }
  }

  function numericInput(field: keyof Pick<BoreOp, 'u' | 'v' | 'diameter' | 'depth'>, label: string) {
    return (
      <label key={field} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
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

  const hasJointDir = bore.connectorKind === 'confirmat' || bore.connectorKind === 'minifix' || bore.connectorKind === 'dowel';
  const isHinge = bore.connectorKind === 'hinge';
  const isShelfPin = bore.role === 'shelfPin-system32';
  const isBroadFace = bore.face.role === 'Top' || bore.face.role === 'Bottom';

  // The persisted (committed) start offset for the selected panel's grid.
  const persistedOffset = getLiveDoc(selectedBorePartPath)?.shelfPinParams?.startOffset ?? 0;

  /** Re-run the carcass shelf-pin grid with a new column start offset, keeping
   *  the panel's other persisted grid params. Warns if a manual edit would be left stale. */
  function commitOffset() {
    if (offsetDraft === null) return;
    const num = parseFloat(offsetDraft);
    if (!isFinite(num)) { setOffsetDraft(null); return; }
    const liveDoc = getLiveDoc(selectedBorePartPath!);
    const base: ShelfPinParams = liveDoc?.shelfPinParams ?? DEFAULT_SHELF_PIN_PARAMS;
    // Warn: regen preserves manually-edited holes at their OLD positions (mergeBores).
    const hasEditedPin = (liveDoc?.bores ?? []).some(
      (b) => b.role === 'shelfPin-system32' && b.edited === true,
    );
    if (hasEditedPin) {
      useAppStore.getState().setStatus(
        t('bore.start_offset_kept_edits', 'Start offset regenerated the shelf-pin grid; manually moved holes stayed at their old positions.'),
      );
    }
    void bus.execute(new UpdateShelfPinStartOffsetCommand({
      params: { ...base, startOffset: num },
      opfs: opfs ?? null,
      store: useAppStore,
    }));
    setOffsetDraft(null);
  }

  function commitJointMove() {
    if (!bore!.jointDir) return;
    const delta = parseFloat(jointDelta);
    if (!isFinite(delta) || delta === 0) { setJointDelta('0'); return; }
    const docs = getConnectorDocs();
    const members = collectConnectorMembers(bore!.connectorId, docs);
    if (members.length === 0) { setJointDelta('0'); return; }
    void bus.execute(new MoveConnectorCommand({
      members,
      worldDir: bore!.jointDir,
      delta,
      opfs: opfs ?? null,
    }));
    setJointDelta('0');
  }

  function commitHingeMove() {
    const delta = parseFloat(hingeDelta);
    if (!isFinite(delta) || delta === 0) { setHingeDelta('0'); return; }
    const docs = getConnectorDocs();
    const members = collectConnectorMembers(bore!.connectorId, docs);
    const cupMember = members.find((m) => m.bore.role === 'hingeCup');
    if (!cupMember) { setHingeDelta('0'); return; }
    // World u-direction of the cup panel = rotate local {x:1,y:0,z:0} by the cup panel's quaternion
    const worldDir = rotate({ x: 1, y: 0, z: 0 }, cupMember.worldPose.quaternion);
    void bus.execute(new MoveConnectorCommand({
      members,
      worldDir,
      delta,
      opfs: opfs ?? null,
    }));
    setHingeDelta('0');
  }

  // B2: for connector mode, collect all member docs (cross-document)
  function handleDelete() {
    const mode = bore!.role === 'shelfPin-system32' ? 'bore' as const : 'connector' as const;
    const targetId = mode === 'bore' ? bore!.id : bore!.connectorId;

    let affectedDocs: Array<{ partPath: string; doc: { bores?: BoreOp[]; suppressedConnectorIds?: string[] } }>;
    if (mode === 'connector') {
      // Build affected docs from all connector members (cross-document)
      const docs = getConnectorDocs();
      const members = collectConnectorMembers(targetId, docs);
      // Deduplicate by partPath
      const seen = new Set<string>();
      affectedDocs = [];
      for (const m of members) {
        if (!seen.has(m.partPath)) {
          seen.add(m.partPath);
          affectedDocs.push({ partPath: m.partPath, doc: m.doc });
        }
      }
      // Fallback to the clicked doc if no members found (e.g., isolated bore)
      if (affectedDocs.length === 0) {
        const liveDoc = getLiveDoc(selectedBorePartPath!);
        if (!liveDoc) return;
        affectedDocs = [{ partPath: selectedBorePartPath!, doc: liveDoc }];
      }
    } else {
      // Shelf-pin single-bore delete: use only the clicked doc
      const liveDoc = getLiveDoc(selectedBorePartPath!);
      if (!liveDoc) return;
      affectedDocs = [{ partPath: selectedBorePartPath!, doc: liveDoc }];
    }

    void bus.execute(new DeleteConnectorCommand({
      targetId,
      mode,
      affectedDocs,
      opfs: opfs ?? null,
    }));
    useAppStore.getState().setSelectedBore(null, null);
  }

  function handleFlipFace() {
    const panelDims = getConnectorDocs().find((d) => d.partPath === selectedBorePartPath)?.panelDims;
    if (!panelDims) return;
    const liveDoc = getLiveDoc(selectedBorePartPath!);
    if (!liveDoc) return;
    const liveBore = (liveDoc.bores ?? []).find((b) => b.id === selectedBoreId);
    if (!liveBore) return;
    void bus.execute(new FlipBoreFaceCommand({
      bore: liveBore,
      panelDims,
      partPath: selectedBorePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }));
  }

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #333', fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#ccc' }}>
        {t('common.bore_properties', 'Bore properties')} — {bore.connectorKind}
      </div>
      {numericInput('u', t('bore.axis_u', 'U (mm)'))}
      {numericInput('v', t('bore.axis_v', 'V (mm)'))}
      {numericInput('diameter', t('bore.diameter_mm', 'Ø (mm)'))}
      {numericInput('depth', t('aria.depth', 'Depth'))}
      {hasJointDir && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: bore.jointDir ? '#aaa' : '#666', fontSize: 11 }}>
            {t('bore.along_joint', 'Along joint')}
          </span>
          <input
            type="number"
            disabled={!bore.jointDir}
            value={jointDelta}
            title={bore.jointDir ? undefined : t('bore.regenerate_to_enable_move', 'Regenerate bores to enable move')}
            style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: bore.jointDir ? '#eee' : '#555', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
            onChange={(e) => setJointDelta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitJointMove(); } if (e.key === 'Escape') { setJointDelta('0'); } }}
            onBlur={() => commitJointMove()}
          />
        </label>
      )}
      {isHinge && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>
            {t('bore.height', 'Height')}
          </span>
          <input
            type="number"
            value={hingeDelta}
            style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
            onChange={(e) => setHingeDelta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitHingeMove(); } if (e.key === 'Escape') { setHingeDelta('0'); } }}
            onBlur={() => commitHingeMove()}
          />
        </label>
      )}
      {isShelfPin && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>
            {t('bore.column_start_offset', 'Column start offset (mm)')}
          </span>
          <input
            type="number"
            aria-label={t('bore.column_start_offset', 'Column start offset (mm)')}
            value={offsetDraft ?? String(persistedOffset)}
            style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
            onChange={(e) => setOffsetDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { commitOffset(); } if (e.key === 'Escape') { setOffsetDraft(null); } }}
            onBlur={() => commitOffset()}
          />
        </label>
      )}
      {matchingPresets.length > 0 && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: '#aaa', fontSize: 11 }}>
            {t('bore.machining_preset', 'Machining preset')}
          </span>
          <select
            aria-label={t('bore.machining_preset', 'Machining preset')}
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
      {isBroadFace && (
        <button
          onClick={handleFlipFace}
          style={{ marginTop: 6, marginRight: 6, fontSize: 11, padding: '2px 10px', background: '#2a2a2a', color: '#eee', border: '1px solid #555', borderRadius: 2, cursor: 'pointer' }}
        >
          {t('bore.flip_face', 'Flip face')}
        </button>
      )}
      <button
        onClick={handleDelete}
        style={{ marginTop: 6, fontSize: 11, padding: '2px 10px', background: '#5a1a1a', color: '#faa', border: '1px solid #933', borderRadius: 2, cursor: 'pointer' }}
      >
        {t('common.delete')}
      </button>
    </div>
  );
}
