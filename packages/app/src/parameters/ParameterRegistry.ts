import { Parser } from 'expr-eval';
import type { SketchParameter } from '@zilventor/shared';
import type { EvaluationError, Result } from './types';

const WHITELIST_FNS = ['min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'round'] as const;

export class ParameterRegistry {
  private params = new Map<string, SketchParameter>();
  private dependents = new Map<string, Set<string>>();
  private parser = new Parser();

  getAll(): SketchParameter[] {
    return Array.from(this.params.values());
  }

  getValue(name: string): number | undefined {
    return this.params.get(name)?.value;
  }

  setParameter(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError> {
    // For Task 5 (skeleton): handle only simple literal expressions.
    // Task 6 will flesh out variable refs + cycle detection + whitelist.
    try {
      const expr = this.parser.parse(input.expression);
      const refs = expr.variables();
      if (refs.length > 0) {
        return { ok: false, error: { code: 'unknown-var', name: refs[0]! } };
      }
      const value = expr.evaluate({});
      if (!Number.isFinite(value)) {
        return { ok: false, error: { code: 'non-finite' } };
      }
      const p: SketchParameter = { name: input.name, expression: input.expression, value, unit: input.unit };
      this.params.set(input.name, p);
      return { ok: true, value: p };
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }
  }
}
