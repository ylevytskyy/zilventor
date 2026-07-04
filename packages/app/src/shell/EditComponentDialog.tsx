import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentColor, ComponentInstance } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { ColorPicker } from './ColorPicker';
import { SetComponentColorCommand } from '../commands/SetComponentColorCommand';
import { ToggleSubAssemblyFlexibleCommand } from '../commands/ToggleSubAssemblyFlexibleCommand';

type Props = {
  initial: ComponentInstance;
  onCommit(patch: Partial<ComponentInstance>): void;
  onCancel(): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 360,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 };
const inputStyle: React.CSSProperties = { flex: 1, background: '#222', color: '#eee', border: '1px solid #333', padding: '4px 6px', fontSize: 11 };
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 10px', cursor: 'pointer', fontSize: 11 };

export function EditComponentDialog({ initial, onCommit, onCancel }: Props): JSX.Element {
  const { t } = useTranslation();
  const [x, setX] = useState(String(initial.position.x));
  const [y, setY] = useState(String(initial.position.y));
  const [z, setZ] = useState(String(initial.position.z));
  const [rx, setRx] = useState(String(initial.rotation.rx));
  const [ry, setRy] = useState(String(initial.rotation.ry));
  const [rz, setRz] = useState(String(initial.rotation.rz));
  const [visible, setVisible] = useState(initial.visible);
  const [color, setColor] = useState<ComponentColor | undefined>(initial.color);
  const palette = useAppStore((s) => s.activeAssembly?.colors ?? {});
  const subAsmDoc = useAppStore((s) => s.subAssemblyDocs[initial.partPath]);
  const isSubAssembly = initial.partPath.endsWith('.ziasm');
  const subAsmLeafCount = subAsmDoc?.components.length ?? 0;
  const flexibleChecked = !!useAppStore((s) =>
    s.activeAssembly?.components.find((c) => c.id === initial.id)?.flexible,
  );
  const bus = useAppStore((s) => s.bus);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void bus.execute(new SetComponentColorCommand({ componentIds: [initial.id], color }));
    onCommit({
      position: { x: Number(x), y: Number(y), z: Number(z) },
      rotation: { rx: Number(rx), ry: Number(ry), rz: Number(rz) },
      visible,
    });
  };

  return (
    <form role="dialog" aria-label={t('aria.edit_component')} onSubmit={handleSubmit} style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('dialog.editComponent.title')}</div>
      <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>{initial.partPath}</div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('dialog.editComponent.position')}</div>
        <div style={row}>
          <label htmlFor="ecd-x" style={{ width: 24 }}>X</label>
          <input id="ecd-x" aria-label="X" value={x} onChange={(e) => setX(e.target.value)} style={inputStyle} />
        </div>
        <div style={row}>
          <label htmlFor="ecd-y" style={{ width: 24 }}>Y</label>
          <input id="ecd-y" aria-label="Y" value={y} onChange={(e) => setY(e.target.value)} style={inputStyle} />
        </div>
        <div style={row}>
          <label htmlFor="ecd-z" style={{ width: 24 }}>Z</label>
          <input id="ecd-z" aria-label="Z" value={z} onChange={(e) => setZ(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('dialog.editComponent.rotation')}</div>
        <div style={row}>
          <label htmlFor="ecd-rx" style={{ width: 24 }}>RX</label>
          <input id="ecd-rx" aria-label="RX" value={rx} onChange={(e) => setRx(e.target.value)} style={inputStyle} />
        </div>
        <div style={row}>
          <label htmlFor="ecd-ry" style={{ width: 24 }}>RY</label>
          <input id="ecd-ry" aria-label="RY" value={ry} onChange={(e) => setRy(e.target.value)} style={inputStyle} />
        </div>
        <div style={row}>
          <label htmlFor="ecd-rz" style={{ width: 24 }}>RZ</label>
          <input id="ecd-rz" aria-label="RZ" value={rz} onChange={(e) => setRz(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <label style={row}>
        <input
          type="checkbox"
          aria-label={t('aria.visible')}
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        <span>{t('dialog.editComponent.visible')}</span>
      </label>

      {isSubAssembly && (
        <div style={{ marginBottom: 8 }}>
          <div role="status" style={{ color: '#aaa', fontSize: 11, marginBottom: 4 }}>
            Sub-assembly ({subAsmLeafCount} components)
          </div>
          <label style={row}>
            <input
              type="checkbox"
              aria-label={t('aria.flexible')}
              checked={flexibleChecked}
              onChange={() => {
                void bus.execute(new ToggleSubAssemblyFlexibleCommand({ componentId: initial.id }));
              }}
            />
            <span>{t('common.flexible')}</span>
          </label>
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('dialog.editComponent.color')}</div>
        <ColorPicker
          value={color}
          palette={palette}
          onChange={setColor}
          onAddPaletteColor={(name, hex) => useAppStore.getState().setAssemblyPaletteColor(name, hex)}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" onClick={onCancel} style={btn}>{t('common.cancel')}</button>
        <button type="submit" style={btn}>{t('common.ok')}</button>
      </div>
    </form>
  );
}
