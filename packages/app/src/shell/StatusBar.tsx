import { useAppStore } from '../store/useAppStore';
import type { DofStatus } from '@zilventor/sketcher-worker';

type Props = {
  message?: string;
  modified?: boolean;
  selection?: string;
};

export function StatusBar({ message, modified = false, selection }: Props) {
  const statusMessage = useAppStore((s) => s.statusMessage);
  const sketchDof = useAppStore((s) => s.sketchDof);

  const displayMessage = message ?? statusMessage ?? 'Ready';

  return (
    <div style={{ display: 'flex', gap: 16, padding: '4px 12px' }}>
      <span>{displayMessage}</span>
      {selection && <span>{selection}</span>}
      {modified && <span style={{ color: '#facc15' }}>● Modified</span>}
      {sketchDof && <DofSegment dof={sketchDof} />}
      <span style={{ marginLeft: 'auto' }}>mm</span>
    </div>
  );
}

function DofSegment({ dof }: { dof: DofStatus }) {
  if (dof.state === 'fully') {
    return <span style={{ color: '#4ade80' }}>Fully constrained</span>;
  }
  if (dof.state === 'over') {
    return <span style={{ color: '#f87171' }}>Over constrained: {dof.count}</span>;
  }
  return <span style={{ color: '#fbbf24' }}>{dof.count} DOF</span>;
}

export default StatusBar;
