import type { AssemblyDocument } from '@zilventor/shared';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/useAppStore';
import type { DofStatus } from '@zilventor/sketcher-worker';
import { visibleLeaves } from '../assembly/walkers/visibleLeaves';

type Props = {
  message?: string;
  modified?: boolean;
  selection?: string;
};

export function StatusBar({ message, modified = false, selection }: Props) {
  const { t } = useTranslation();
  const statusMessage = useAppStore((s) => s.statusMessage);
  const sketchDof = useAppStore((s) => s.sketchDof);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const solverDiagnostics = useAppStore((s) => s.solverDiagnostics);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const subAssemblyDiagnostics = useAppStore((s) => s.subAssemblyDiagnostics);

  const displayMessage = message ?? statusMessage ?? 'Ready';
  const hasConstraints = (activeAssembly?.constraints?.length ?? 0) > 0;

  // Compute sub-asm leaf totals from the active assembly.
  let leafCount = 0;
  let subAsmCount = 0;
  if (activeAssembly) {
    const cache = {
      get: (partPath: string) =>
        subAssemblyDocs[partPath]
          ? ({ kind: 'ok' as const, doc: subAssemblyDocs[partPath]!, partPath })
          : undefined,
    };
    const leaves = visibleLeaves(activeAssembly, cache);
    leafCount = leaves.length;
    const seen = new Set<string>();
    function walk(doc: AssemblyDocument, stack: Set<string>): void {
      for (const c of doc.components) {
        if (!c.partPath.endsWith('.ziasm')) continue;
        if (stack.has(c.partPath)) continue;
        seen.add(c.partPath);
        const child = subAssemblyDocs[c.partPath];
        if (child) {
          const next = new Set(stack);
          next.add(c.partPath);
          walk(child, next);
        }
      }
    }
    walk(activeAssembly, new Set());
    subAsmCount = seen.size;
  }

  return (
    <div style={{ display: 'flex', gap: 16, padding: '4px 12px' }}>
      <span>{displayMessage}</span>
      {selection && <span>{selection}</span>}
      {modified && <span style={{ color: '#facc15' }}>● {t('status.modified')}</span>}
      {sketchDof && <DofSegment dof={sketchDof} />}
      {hasConstraints && <AssemblyDofSegment diagnostics={solverDiagnostics} />}
      {activeAssembly && (
        <span style={{ color: '#aaa' }}>
          {t('status.components', { leafCount, subAsmCount })}
        </span>
      )}
      {subAssemblyDiagnostics.length > 0 && (
        <span
          aria-label={t('status.diagnosticsAria', { count: subAssemblyDiagnostics.length })}
          title={subAssemblyDiagnostics.map((d) => `${d.kind}: ${d.partPath} — ${d.message}`).join('\n')}
          style={{ color: '#f87171', cursor: 'pointer' }}
        >
          ⚠ {subAssemblyDiagnostics.length}
        </span>
      )}
      <span style={{ marginLeft: 'auto' }}>mm</span>
    </div>
  );
}

function DofSegment({ dof }: { dof: DofStatus }) {
  const { t } = useTranslation();
  if (dof.state === 'fully') {
    return <span style={{ color: '#4ade80' }}>{t('status.dof.fully')}</span>;
  }
  if (dof.state === 'over') {
    return <span style={{ color: '#f87171' }}>{t('status.dof.over', { count: dof.count })}</span>;
  }
  return <span style={{ color: '#fbbf24' }}>{t('status.dof.under', { count: dof.count })}</span>;
}

type SolverDiagnostics = {
  dofCount: number;
  status: 'fully-constrained' | 'underconstrained' | 'over-constrained' | 'did-not-converge';
  perConstraint: Map<string, unknown>;
};

function AssemblyDofSegment({ diagnostics }: { diagnostics: SolverDiagnostics }) {
  const { t } = useTranslation();
  if (diagnostics.status === 'fully-constrained') {
    return <span style={{ color: '#4ade80' }}>{t('status.asm.fully')}</span>;
  }
  if (diagnostics.status === 'underconstrained') {
    return <span style={{ color: '#fbbf24' }}>{t('status.asm.under', { count: diagnostics.dofCount })}</span>;
  }
  if (diagnostics.status === 'over-constrained') {
    return <span style={{ color: '#f87171' }}>{t('status.asm.over')}</span>;
  }
  // did-not-converge
  return <span style={{ color: '#f87171' }}>{t('status.asm.noConverge')}</span>;
}

export default StatusBar;
