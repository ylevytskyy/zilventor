import { useMemo, useState } from 'react';
import { parsePathKey } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';
import { ColorPicker } from './ColorPicker';
import { SetBomItemNumberCommand } from '../commands/SetBomItemNumberCommand';
import { SetComponentColorCommand } from '../commands/SetComponentColorCommand';
import { SetComponentColorOverrideCommand } from '../commands/SetComponentColorOverrideCommand';
import { ExportBomCsvCommand } from '../commands/ExportBomCsvCommand';

type Props = { partNames: Map<string, string> };

export function BomTable({ partNames }: Props) {
  const assembly = useAppStore((s) => s.activeAssembly);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const palette = assembly?.colors ?? {};
  const subAsmCacheAdapter = useMemo(
    () => ({
      get: (p: string) =>
        subAssemblyDocs[p]
          ? ({ kind: 'ok' as const, doc: subAssemblyDocs[p]!, partPath: p })
          : undefined,
    }),
    [subAssemblyDocs],
  );
  const rows = useMemo(
    () => (assembly ? aggregateBomRecursive(assembly, subAsmCacheAdapter, partNames) : []),
    [assembly, subAsmCacheAdapter, partNames],
  );
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [colorEditingRowKey, setColorEditingRowKey] = useState<string | null>(null);

  return (
    <div data-testid="bom-table">
      <button onClick={() => void new ExportBomCsvCommand({ partNames }).apply()}>Export CSV</button>
      <table>
        <thead>
          <tr>
            <th>Item#</th>
            <th>QTY</th>
            <th>Part Name</th>
            <th>Color</th>
            <th>Part Path</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowKey} onClick={() => useAppStore.getState().selectComponentPaths(r.componentIds.map((k) => parsePathKey(k)))}>
              <td onClick={(e) => e.stopPropagation()}>
                {editingRowKey === r.rowKey ? (
                  <input
                    autoFocus
                    aria-label={`item-number-${r.rowKey}`}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      const n = Number.parseInt(editValue, 10);
                      if (Number.isFinite(n) && n > 0 && n <= 9999) {
                        void new SetBomItemNumberCommand({ rowKey: r.rowKey, n }).apply();
                      } else {
                        useAppStore.getState().setStatus('Item# must be a positive integer up to 9999');
                      }
                      setEditingRowKey(null);
                    }}
                  />
                ) : (
                  <span
                    onClick={() => {
                      setEditValue(String(r.itemNumber));
                      setEditingRowKey(r.rowKey);
                    }}
                  >
                    {r.itemNumber}
                  </span>
                )}
              </td>
              <td>{r.qty}</td>
              <td>{r.partName}</td>
              <td onClick={(e) => { e.stopPropagation(); setColorEditingRowKey(r.rowKey); }}>
                {colorEditingRowKey === r.rowKey ? (
                  <ColorPicker
                    value={r.color}
                    palette={palette}
                    onChange={(next) => {
                      for (const cid of r.componentIds) {
                        const path = parsePathKey(cid);
                        if (path.length === 1) {
                          void new SetComponentColorCommand({ id: path[0]!, color: next }).apply();
                        } else {
                          void new SetComponentColorOverrideCommand({ path, color: next ?? null }).apply();
                        }
                      }
                      setColorEditingRowKey(null);
                    }}
                    onAddPaletteColor={(name, hex) => useAppStore.getState().setAssemblyPaletteColor(name, hex)}
                  />
                ) : (
                  r.color ? (r.color.kind === 'palette' ? r.color.name : r.color.hex) : '—'
                )}
              </td>
              <td>{r.partPath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
