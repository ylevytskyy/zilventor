// packages/app/src/drawing/AddBreakDialog.tsx

type AddBreakDialogProps = {
  open: boolean;
  onConfirm: (axis: 'x' | 'y') => void;
  onCancel: () => void;
};

export function AddBreakDialog({ open, onConfirm, onCancel }: AddBreakDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-break-dialog-title"
      style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white', border: '1px solid #ccc',
        borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        padding: 16, zIndex: 2000, width: 260,
      }}
    >
      <div id="add-break-dialog-title" style={{ fontWeight: 600, marginBottom: 12 }}>
        Choose break direction
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          aria-label="Horizontal break (X axis)"
          onClick={() => onConfirm('x')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          Horizontal break (remove X band)
        </button>
        <button
          type="button"
          aria-label="Vertical break (Y axis)"
          onClick={() => onConfirm('y')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          Vertical break (remove Y band)
        </button>
      </div>
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        style={{ padding: '4px 10px', cursor: 'pointer', float: 'right' }}
      >
        Cancel
      </button>
    </div>
  );
}
