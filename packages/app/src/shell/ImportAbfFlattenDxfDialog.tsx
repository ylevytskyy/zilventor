import { useState } from 'react';
import type { MaterialId, MaterialRegistry } from '@zilventor/shared';

/**
 * ImportAbfFlattenDxfDialog (S4) — one row per detected ABF material-group
 * token (`<MATERIAL>_THICKNESS_<mm>`): a material picker (from the app's
 * `MaterialRegistry`) + a thickness number input prefilled from the `<mm>`
 * token. `onConfirm` returns the per-group selections for the orchestrating
 * `ImportAbfFlattenDxfCommand` (S3) to consume.
 *
 * i18n copy is S5's job — dev-placeholder English strings only, per the
 * ratified plan (docs/superpowers/plans/2026-07-04-abf-import-as-panels.md, S4).
 */

export type AbfImportGroupSelection = {
  readonly groupToken: string;
  readonly materialId: MaterialId;
  readonly thickness: number;
};

export type ImportAbfFlattenDxfDialogProps = {
  readonly isOpen: boolean;
  readonly groupTokens: readonly string[];
  readonly materials: MaterialRegistry;
  readonly onCancel: () => void;
  readonly onConfirm: (selections: readonly AbfImportGroupSelection[]) => void;
};

const THICKNESS_TOKEN_RE = /_THICKNESS_(\d+(?:\.\d+)?)$/;

function prefillThickness(groupToken: string): number {
  const match = THICKNESS_TOKEN_RE.exec(groupToken);
  return match ? Number(match[1]) : 0;
}

type RowState = { materialId: MaterialId; thickness: number };

export function ImportAbfFlattenDxfDialog(props: ImportAbfFlattenDxfDialogProps): JSX.Element | null {
  const defaultMaterialId: MaterialId = props.materials[0]?.id ?? '';

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const token of props.groupTokens) {
      init[token] = { materialId: defaultMaterialId, thickness: prefillThickness(token) };
    }
    return init;
  });

  if (!props.isOpen) return null;

  const rowFor = (token: string): RowState =>
    rows[token] ?? { materialId: defaultMaterialId, thickness: prefillThickness(token) };

  const setMaterialId = (token: string, materialId: MaterialId) => {
    setRows((cur) => ({ ...cur, [token]: { ...rowFor(token), materialId } }));
  };

  const setThickness = (token: string, thickness: number) => {
    setRows((cur) => ({ ...cur, [token]: { ...rowFor(token), thickness } }));
  };

  const confirm = () => {
    const selections: AbfImportGroupSelection[] = props.groupTokens.map((token) => ({
      groupToken: token,
      ...rowFor(token),
    }));
    props.onConfirm(selections);
  };

  return (
    <div role="dialog" aria-label="Import ABF flatten DXF" className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-neutral-900 text-neutral-100 rounded shadow-lg p-4 w-[560px]">
        <h2 className="text-sm font-semibold mb-3">Import ABF flatten DXF</h2>
        <table className="w-full text-xs mb-3">
          <thead>
            <tr>
              <th className="text-left">Material group</th>
              <th className="text-left">Material</th>
              <th className="text-left">Thickness (mm)</th>
            </tr>
          </thead>
          <tbody>
            {props.groupTokens.map((token) => {
              const row = rowFor(token);
              return (
                <tr key={token}>
                  <td className="py-1 pr-2">{token}</td>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`Material for ${token}`}
                      value={row.materialId}
                      onChange={(e) => setMaterialId(token, e.target.value)}
                    >
                      {props.materials.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1">
                    <input
                      aria-label={`Thickness for ${token}`}
                      type="number"
                      value={row.thickness}
                      onChange={(e) => setThickness(token, Number(e.target.value))}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex justify-end gap-2">
          <button onClick={props.onCancel} className="text-xs px-2 py-1 hover:text-white">Cancel</button>
          <button onClick={confirm} className="text-xs px-2 py-1 bg-blue-700 hover:bg-blue-600">Import</button>
        </div>
      </div>
    </div>
  );
}
