import { useState } from 'react';

type Tile = { partPath: string; name: string; thumbnail: string };

type Props = {
  tiles: Tile[];
  onPlace(partPath: string): void;
  onCancel(): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 480,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8,
};
const tileStyle = (selected: boolean): React.CSSProperties => ({
  border: selected ? '2px solid #5b9ad8' : '1px solid #333',
  background: '#222', padding: 6, borderRadius: 4, cursor: 'pointer',
  textAlign: 'center', fontSize: 11,
});
const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};

export function PlaceComponentDialog({ tiles, onPlace, onCancel }: Props): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div role="dialog" aria-label="Place Component" style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Place Component</div>
      <div style={grid}>
        {tiles.map((t) => (
          <div
            key={t.partPath}
            style={tileStyle(selected === t.partPath)}
            onClick={() => setSelected(t.partPath)}
          >
            <img
              src={t.thumbnail}
              alt={t.name}
              style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', marginBottom: 4 }}
            />
            <div>{t.name}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={btn}>Cancel</button>
        <button
          onClick={() => selected && onPlace(selected)}
          disabled={!selected}
          style={btn}
        >
          Place
        </button>
      </div>
    </div>
  );
}
