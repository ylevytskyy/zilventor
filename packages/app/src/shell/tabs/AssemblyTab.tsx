import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../../commands/OpenPlaceComponentDialogCommand';
import { OpenEditComponentDialogCommand } from '../../commands/OpenEditComponentDialogCommand';
import { DeleteComponentCommand } from '../../commands/DeleteComponentCommand';
import { OpenPlaceConstraintDialogCommand } from '../../commands/OpenPlaceConstraintDialogCommand';
import { OpenEditAssemblyConstraintDialogCommand } from '../../commands/OpenEditAssemblyConstraintDialogCommand';
import { DeleteAssemblyConstraintCommand } from '../../commands/DeleteAssemblyConstraintCommand';
import { ToggleConstraintSuppressionCommand } from '../../commands/ToggleConstraintSuppressionCommand';

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginRight: 4,
};

export function AssemblyTab(): JSX.Element {
  const selectedId = useAppStore((s) => s.selectedComponentIds[0] ?? null);
  const hasAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');
  const selectedConstraintId = useAppStore((s) => s.selectedConstraintId);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const selectedConstraint = activeAssembly?.constraints.find((c) => c.id === selectedConstraintId) ?? null;
  const isSuppressed = selectedConstraint?.suppressed ?? false;

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
    </div>
  );
}
