import type { ParamOrLiteral } from '@zilventor/shared';

export function parseParamOrLiteral(s: string): ParamOrLiteral {
  const trimmed = s.trim();
  if (trimmed.startsWith('=')) return { kind: 'param', paramName: trimmed.slice(1).trim() };
  const v = Number(trimmed);
  return { kind: 'literal', value: Number.isFinite(v) ? v : 0 };
}
