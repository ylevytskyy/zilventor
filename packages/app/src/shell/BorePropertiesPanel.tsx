import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { BoreOp } from '@zilventor/shared';
import { EditBoreCommand } from '../commands/EditBoreCommand';
import { DeleteConnectorCommand } from '../commands/DeleteConnectorCommand';

type OpfsRW = { read(p: string): Promise<Uint8Array>; write(p: string, b: Uint8Array): Promise<void> };

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
  opfs?: OpfsRW | null;
}

/**
 * Renders a numeric-edit panel for the currently-selected bore.
 * Reads selectedBoreId + selectedBorePartPath from the store.
 * Looks up the LIVE bore reference via getLiveBores at render time.
 * Enter commits via EditBoreCommand; Escape cancels.
 */
export function BorePropertiesPanel({ getLiveBores, getLiveDoc, opfs = null }: Props): JSX.Element | null {
  const { t } = useTranslation();
  const selectedBoreId = useAppStore((s) => s.selectedBoreId);
  const selectedBorePartPath = useAppStore((s) => s.selectedBorePartPath);

  // Resolve the live bore reference on every render — NOT cached.
  const bore = selectedBoreId && selectedBorePartPath
    ? (getLiveBores(selectedBorePartPath) ?? []).find((b) => b.id === selectedBoreId) ?? null
    : null;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const resetDraft = useCallback(() => setDraft({}), []);

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

  function handleDelete() {
    const liveDoc = getLiveDoc(selectedBorePartPath!);
    if (!liveDoc) return;
    const mode = bore!.role === 'shelfPin-system32' ? 'bore' as const : 'connector' as const;
    const targetId = mode === 'bore' ? bore!.id : bore!.connectorId;
    void new DeleteConnectorCommand({
      targetId,
      mode,
      affectedDocs: [{ partPath: selectedBorePartPath!, doc: liveDoc }],
      opfs: opfs ?? null,
    }).apply();
    useAppStore.getState().setSelectedBore(null, null);
  }

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #333', fontSize: 11 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: '#ccc' }}>
        {t('common.bore_properties', 'Bore properties')} — {bore.connectorKind}
      </div>
      {numericInput('u', 'U (mm)')}
      {numericInput('v', 'V (mm)')}
      {numericInput('diameter', 'Ø (mm)')}
      {numericInput('depth', t('aria.depth', 'Depth'))}
      {hasJointDir && (
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ minWidth: 80, color: bore.jointDir ? '#aaa' : '#666', fontSize: 11 }}>
            {t('bore.along_joint', 'Along joint')}
          </span>
          <input
            type="number"
            disabled={!bore.jointDir}
            value={0}
            title={bore.jointDir ? undefined : t('bore.regenerate_to_enable_move', 'Regenerate bores to enable move')}
            style={{ width: 80, fontSize: 11, background: '#2a2a2a', color: bore.jointDir ? '#eee' : '#555', border: '1px solid #555', borderRadius: 2, padding: '1px 4px' }}
            onChange={() => { /* MoveConnectorCommand — wired after connectorCoupling lands */ }}
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
