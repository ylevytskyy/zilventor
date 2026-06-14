import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { BoreOp } from '@zilventor/shared';
import { rotate } from '@zilventor/shared/src/jointMath';
import { EditBoreCommand } from '../commands/EditBoreCommand';
import { DeleteConnectorCommand } from '../commands/DeleteConnectorCommand';
import { MoveConnectorCommand } from '../commands/MoveConnectorCommand';
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
  getLiveDoc: (partPath: string) => { bores?: BoreOp[]; suppressedConnectorIds?: string[] } | null;
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
 */
export function BorePropertiesPanel({ getLiveBores, getLiveDoc, getConnectorDocs, opfs = null }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const selectedBoreId = useAppStore((s) => s.selectedBoreId);
  const selectedBorePartPath = useAppStore((s) => s.selectedBorePartPath);
  const bus = useAppStore((s) => s.bus);

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

  if (!bore || !selectedBorePartPath) return null;

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
    void new EditBoreCommand({
      bore: liveBore,
      patch,
      partPath: selectedBorePartPath!,
      doc: liveDoc,
      opfs: opfs ?? null,
    }).apply();
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

    void new DeleteConnectorCommand({
      targetId,
      mode,
      affectedDocs,
      opfs: opfs ?? null,
    }).apply();
    useAppStore.getState().setSelectedBore(null, null);
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
      <button
        onClick={handleDelete}
        style={{ marginTop: 6, fontSize: 11, padding: '2px 10px', background: '#5a1a1a', color: '#faa', border: '1px solid #933', borderRadius: 2, cursor: 'pointer' }}
      >
        {t('common.delete')}
      </button>
    </div>
  );
}
