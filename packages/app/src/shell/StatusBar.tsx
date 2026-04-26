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
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const solverDiagnostics = useAppStore((s) => s.solverDiagnostics);

  const displayMessage = message ?? statusMessage ?? 'Ready';
  const hasConstraints = (activeAssembly?.constraints?.length ?? 0) > 0;

  return (
    <div style={{ display: 'flex', gap: 16, padding: '4px 12px' }}>
      <span>{displayMessage}</span>
      {selection && <span>{selection}</span>}
      {modified && <span style={{ color: '#facc15' }}>● Modified</span>}
      {sketchDof && <DofSegment dof={sketchDof} />}
      {hasConstraints && <AssemblyDofSegment diagnostics={solverDiagnostics} />}
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

type SolverDiagnostics = {
  dofCount: number;
  status: 'fully-constrained' | 'underconstrained' | 'over-constrained' | 'did-not-converge';
  perConstraint: Map<string, unknown>;
};

function AssemblyDofSegment({ diagnostics }: { diagnostics: SolverDiagnostics }) {
  if (diagnostics.status === 'fully-constrained') {
    return <span style={{ color: '#4ade80' }}>Assembly: fully constrained</span>;
  }
  if (diagnostics.status === 'underconstrained') {
    return <span style={{ color: '#fbbf24' }}>Assembly: {diagnostics.dofCount} DOF</span>;
  }
  if (diagnostics.status === 'over-constrained') {
    return <span style={{ color: '#f87171' }}>Assembly: over-constrained</span>;
  }
  // did-not-converge
  return <span style={{ color: '#f87171' }}>Assembly: solver did not converge</span>;
}

export default StatusBar;
