import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../../commands/OpenPlaceComponentDialogCommand';
import { OpenEditComponentDialogCommand } from '../../commands/OpenEditComponentDialogCommand';
import { DeleteComponentCommand } from '../../commands/DeleteComponentCommand';
import { OpenPlaceConstraintDialogCommand } from '../../commands/OpenPlaceConstraintDialogCommand';
import { OpenEditAssemblyConstraintDialogCommand } from '../../commands/OpenEditAssemblyConstraintDialogCommand';
import { DeleteAssemblyConstraintCommand } from '../../commands/DeleteAssemblyConstraintCommand';
import { ToggleConstraintSuppressionCommand } from '../../commands/ToggleConstraintSuppressionCommand';
import { OpenBomTabCommand } from '../../commands/OpenBomTabCommand';
import { RenumberBomCommand } from '../../commands/RenumberBomCommand';
import type { PartInfo } from '@zilventor/shared';
import { pickFile } from '../fsaFallback';

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginRight: 4,
};

type Props = { partInfo?: Map<string, PartInfo> };

export function AssemblyTab({ partInfo }: Props = {}): JSX.Element {
  const selectedId = useAppStore((s) => {
    const p = s.selectedComponentPaths[0];
    return p ? p[p.length - 1] ?? null : null;
  });
  const hasAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
  const selectedConstraintId = useAppStore((s) => s.selectedConstraintId);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const selectedConstraint = activeAssembly?.constraints.find((c) => c.id === selectedConstraintId) ?? null;
  const isSuppressed = selectedConstraint?.suppressed ?? false;

  const handleInsertFromStep = async () => {
    const { kernel, bus } = useAppStore.getState();
    if (!kernel) return;
    try {
      const file = await pickFile([
        { description: 'STEP file', accept: { 'application/step': ['.step', '.stp'] } },
        { description: 'ZIP archive (with STEP inside)', accept: { 'application/zip': ['.zip'] } },
      ]);
      if (!file) return;

      // ZIP branch: extract first STEP entry
      if (/\.zip$/i.test(file.name)) {
        const { extractStepFromZip } = await import('../../import/extractStepFromZip');
        const zipBytes = new Uint8Array(await file.arrayBuffer());
        const extracted = extractStepFromZip(zipBytes);
        if (!extracted) {
          useAppStore.getState().setStatus(
            'Insert From STEP failed: No STEP/STP file found in archive',
          );
          return;
        }
        const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
        const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
        const opfs = await Opfs.forNavigator();
        const cmd = new ImportStepAsComponentCommand({ stepBytes: extracted.stepBytes, fileName: extracted.fileName, kernel, opfs });
        await bus.execute(cmd);
        return;
      }

      const stepBytes = await file.arrayBuffer();
      const { ImportStepAsComponentCommand } = await import('../../commands/ImportStepAsComponentCommand');
      const { Opfs } = await import('@zilventor/kernel/src/storage/Opfs');
      const opfs = await Opfs.forNavigator();
      const cmd = new ImportStepAsComponentCommand({ stepBytes, fileName: file.name, kernel, opfs });
      await bus.execute(cmd);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      useAppStore.getState().setStatus(`Insert From STEP failed: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: 4 }}>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Component</div>
        <button
          aria-label="Place"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceComponentDialogCommand()}
          style={btn}
        >
          Place
        </button>
        <button
          aria-label="Insert From STEP…"
          disabled={!hasAssembly}
          onClick={handleInsertFromStep}
          style={btn}
        >
          Insert From STEP…
        </button>
        <button
          aria-label="Edit"
          disabled={!selectedId}
          onClick={() => selectedId && OpenEditComponentDialogCommand(selectedId)}
          style={btn}
        >
          Edit
        </button>
        <button
          aria-label="Delete"
          disabled={!selectedId}
          onClick={async () => {
            if (!selectedId) return;
            const cmd = new DeleteComponentCommand({ id: selectedId });
            await cmd.apply();
          }}
          style={btn}
        >
          Delete
        </button>
      </div>
      <div style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>Constraint</div>
        <button
          aria-label="Mate"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('mate')}
          style={btn}
        >
          Mate
        </button>
        <button
          aria-label="Flush"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('flush')}
          style={btn}
        >
          Flush
        </button>
        <button
          aria-label="Angle"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('angle')}
          style={btn}
        >
          Angle
        </button>
        <button
          aria-label="Insert"
          disabled={!hasAssembly}
          onClick={() => OpenPlaceConstraintDialogCommand('insert')}
          style={btn}
        >
          Insert
        </button>
        <button
          aria-label="Edit Constraint"
          disabled={!selectedConstraintId}
          onClick={() => selectedConstraintId && OpenEditAssemblyConstraintDialogCommand(selectedConstraintId)}
          style={btn}
        >
          Edit Constraint
        </button>
        <button
          aria-label="Delete Constraint"
          disabled={!selectedConstraintId}
          onClick={async () => {
            if (!selectedConstraintId) return;
            const cmd = new DeleteAssemblyConstraintCommand({ id: selectedConstraintId });
            await cmd.apply();
          }}
          style={btn}
        >
          Delete Constraint
        </button>
        <button
          aria-label="Suppress"
          disabled={!selectedConstraintId}
          onClick={async () => {
            if (!selectedConstraintId) return;
            const cmd = new ToggleConstraintSuppressionCommand({ id: selectedConstraintId });
            await cmd.apply();
          }}
          style={btn}
        >
          {isSuppressed ? 'Unsuppress' : 'Suppress'}
        </button>
      </div>
      <div aria-label="BOM panel" style={{ marginRight: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>BOM</div>
        <button
          aria-label="BOM"
          disabled={!hasAssembly}
          onClick={async () => {
            const cmd = new OpenBomTabCommand();
            await cmd.apply();
          }}
          style={btn}
        >
          BOM
        </button>
        <button
          aria-label="Renumber"
          disabled={!hasAssembly}
          onClick={async () => {
            const cmd = new RenumberBomCommand({ partInfo: partInfo ?? new Map() });
            await cmd.apply();
          }}
          style={btn}
        >
          Renumber
        </button>
      </div>
    </div>
  );
}
