import { ok, err, type Result, type KernelError, newCorrelationId, type UnitKind } from '@zilventor/shared';

export function resolve(expression: string, _unit: UnitKind): Result<number, KernelError> {
  const trimmed = expression.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'nan') {
    return err({ kind: 'invalidParameter', message: `"${expression}" is not a number`, correlationId: newCorrelationId() });
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return err({ kind: 'invalidParameter', message: `"${expression}" is not a number`, correlationId: newCorrelationId() });
  }
  return ok(n);
}
