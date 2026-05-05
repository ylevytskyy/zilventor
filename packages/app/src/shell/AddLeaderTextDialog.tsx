import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { AddDrawingAnnotationCommand } from '../commands/AddDrawingAnnotationCommand';
import type { DrawingAnnotation } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 340, color: '#eee', fontSize: 12,
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

type DialogState = {
  sheetId: string;
  ann: Extract<DrawingAnnotation, { kind: 'leader' }>;
};

export function AddLeaderTextDialog(): JSX.Element | null {
  const state = useAppStore((s) => (s as any).addLeaderTextDialogState as DialogState | null);
  const bus = useAppStore((s) => s.bus);
  const [text, setText] = React.useState('');

  React.useEffect(() => {
    if (state) setText('');
  }, [state]);

  if (!state) return null;

  const close = () => useAppStore.setState({ addLeaderTextDialogState: null } as any);

  const handleOk = async (): Promise<void> => {
    if (!text.trim()) return;
    const ann: DrawingAnnotation = { ...state.ann, text: text.trim() };
    await bus.execute(new AddDrawingAnnotationCommand({ sheetId: state.sheetId, ann }));
    close();
  };

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div style={panelStyle} role="dialog" aria-label="Leader Text"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key === 'Enter' && text.trim()) { void handleOk(); }
        }} tabIndex={-1}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Leader Text</div>
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="lt-text" style={{ fontSize: 11 }}>Text</label>
          <input
            id="lt-text"
            aria-label="Text"
            type="text"
            autoFocus
            style={{
              display: 'block', width: '100%', background: '#222',
              border: '1px solid #444', color: '#eee', padding: '4px 6px',
              fontSize: 11, marginTop: 4, boxSizing: 'border-box',
            }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={btnStyle} onClick={close}>Cancel</button>
          <button
            style={okBtnStyle}
            disabled={!text.trim()}
            aria-disabled={!text.trim()}
            onClick={() => { void handleOk(); }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
