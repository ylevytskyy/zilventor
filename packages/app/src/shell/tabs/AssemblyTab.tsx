import { useAppStore } from '../../store/useAppStore';
import { OpenPlaceComponentDialogCommand } from '../../commands/OpenPlaceComponentDialogCommand';
import { OpenEditComponentDialogCommand } from '../../commands/OpenEditComponentDialogCommand';
import { DeleteComponentCommand } from '../../commands/DeleteComponentCommand';

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginRight: 4,
};

export function AssemblyTab(): JSX.Element {
  const selectedId = useAppStore((s) => s.selectedComponentId);
  const hasAssembly = useAppStore((s) => s.activeDocument?.kind === 'assembly');

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
    </div>
  );
}
