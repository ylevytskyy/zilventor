import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { ClashReportPanel } from '../ClashReportPanel';
import { runInterferenceCheck } from '../../assembly/runInterferenceCheck';
import { CLEARANCE_DEFAULT_MM } from '@zilventor/shared';
import { resolvePartInfo } from '../resolvePartInfo';
import { computeInnerStaticPoses } from '../../assembly/computeInnerStaticPoses';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function InspectTab(): JSX.Element {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clearanceMm, setClearanceMm] = useState(String(CLEARANCE_DEFAULT_MM));
  const [running, setRunning] = useState(false);

  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const kernel = useAppStore((s) => s.kernel);
  const clashRows = useAppStore((s) => s.clashRows);
  const clashRan = useAppStore((s) => s.clashRan);
  const setClashResult = useAppStore((s) => s.setClashResult);
  const setClashHighlightKeys = useAppStore((s) => s.setClashHighlightKeys);
  const selectComponentPaths = useAppStore((s) => s.selectComponentPaths);
  const viewport = useAppStore((s) => s.viewport);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const subAssemblyInnerPoses = useAppStore((s) => s.subAssemblyInnerPoses);
  const componentPoses = useAppStore((s) => s.componentPoses);

  const handleRun = useCallback(async () => {
    if (!activeAssembly || !kernel) return;
    const threshold = parseFloat(clearanceMm);
    if (!Number.isFinite(threshold) || threshold <= 0) return;

    setDialogOpen(false);
    setRunning(true);

    // Clear previous highlights before new run.
    const sm = (viewport as { getSceneManager?(): unknown } | null)?.getSceneManager?.() as
      | { setClashHighlight(keys: string[]): void }
      | null;
    sm?.setClashHighlight([]);
    setClashHighlightKeys([]);

    try {
      const opfs = await Opfs.forNavigator();

      // Build sub-asm cache (mirrors ExportStepCommand._buildSubAsmCache).
      let docs = { ...subAssemblyDocs };
      const innerPoses = { ...subAssemblyInnerPoses };
      if (Object.keys(docs).length === 0) {
        const stack: AssemblyDocument[] = [activeAssembly];
        const seen = new Set<string>();
        while (stack.length) {
          const d = stack.pop()!;
          for (const c of d.components) {
            if (!c.partPath.endsWith('.ziasm')) continue;
            if (seen.has(c.partPath)) continue;
            seen.add(c.partPath);
            if (docs[c.partPath]) { stack.push(docs[c.partPath]!); continue; }
            try {
              if (await opfs.exists(c.partPath)) {
                const sub = await unpackAssembly(await opfs.read(c.partPath));
                docs[c.partPath] = sub;
                innerPoses[c.partPath] = computeInnerStaticPoses(sub);
                stack.push(sub);
              }
            } catch { /* skip corrupt */ }
          }
        }
      } else {
        for (const [p, d] of Object.entries(docs)) {
          if (!innerPoses[p]) innerPoses[p] = computeInnerStaticPoses(d);
        }
      }

      const subAsmCache = {
        get: (p: string) =>
          docs[p]
            ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p, ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}) })
            : undefined,
      };

      const partInfoCache = new Map();
      const rows = await runInterferenceCheck({
        assembly: activeAssembly,
        kernel: kernel as any,
        opfs,
        subAsmCache,
        componentPoses,
        partInfoCache,
        resolvePartInfo: (o, p, c) =>
          resolvePartInfo(o as import('@zilventor/kernel/src/storage/Opfs').Opfs, p, c),
        clearanceThreshold: threshold,
      });

      setClashResult(rows);
    } catch (e) {
      console.error('InterferenceCheck failed:', e);
      setClashResult([]);
    } finally {
      setRunning(false);
    }
  }, [activeAssembly, kernel, clearanceMm, viewport, subAssemblyDocs, subAssemblyInnerPoses, componentPoses, setClashResult, setClashHighlightKeys]);

  const handleRowClick = useCallback((aPath: ComponentPath, bPath: ComponentPath, aKey: string, bKey: string) => {
    // SC-7: selectComponentPaths takes ComponentPath[] (string arrays).
    selectComponentPaths([aPath as string[], bPath as string[]]);
    // Highlight via SceneManager.
    const sm = (viewport as { getSceneManager?(): unknown } | null)?.getSceneManager?.() as
      | { setClashHighlight(keys: string[]): void }
      | null;
    sm?.setClashHighlight([aKey, bKey]);
    setClashHighlightKeys([aKey, bKey]);
  }, [selectComponentPaths, viewport, setClashHighlightKeys]);

  const isAssembly = !!activeAssembly;

  return (
    <div style={{ padding: 8 }}>
      <button
        disabled={!isAssembly || !kernel || running}
        onClick={() => setDialogOpen(true)}
        style={{ marginBottom: 8 }}
      >
        {running ? '…' : t('clash.button')}
      </button>

      {dialogOpen && (
        <div style={{ background: '#2a2a2a', padding: 8, borderRadius: 4, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{t('clash.dialog_title')}</div>
          <label style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>
            {t('clash.clearance_label')}
            <input
              type="number"
              min="0"
              step="0.1"
              value={clearanceMm}
              onChange={(e) => setClearanceMm(e.target.value)}
              style={{ marginLeft: 8, width: 60 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={handleRun}>{t('clash.run')}</button>
            <button onClick={() => setDialogOpen(false)}>{t('clash.cancel')}</button>
          </div>
        </div>
      )}

      <ClashReportPanel
        rows={clashRows}
        ran={clashRan}
        onRowClick={handleRowClick}
      />
    </div>
  );
}
