import { Parser, type Expression } from 'expr-eval';
import type { SketchParameter } from '@zilventor/shared';
import type { EvaluationError, Result } from './types';

const WHITELIST_FNS = new Set(['min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'round']);

type ParsedEntry = { parameter: SketchParameter; expr: Expression; refs: string[] };

export class ParameterRegistry {
  private entries = new Map<string, ParsedEntry>();
  private dependents = new Map<string, Set<string>>();   // who depends on this name
  private parser = new Parser();
  private listeners = new Set<() => void>();

  getAll(): SketchParameter[] {
    return Array.from(this.entries.values()).map((e) => e.parameter);
  }

  getValue(name: string): number | undefined {
    return this.entries.get(name)?.parameter.value;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private batchDepth = 0;
  private pendingEmit = false;

  private emit(): void {
    if (this.batchDepth > 0) {
      this.pendingEmit = true;
      return;
    }
    for (const l of this.listeners) l();
  }

  /**
   * Runs `fn`, coalescing every parameter-change notification it triggers into a
   * single subscriber burst emitted once after `fn` returns. Nestable via a depth
   * counter; the deferred emit fires only when the outermost batch unwinds, and
   * only if at least one mutation occurred inside.
   */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingEmit) {
        this.pendingEmit = false;
        this.emit();
      }
    }
  }

  /**
   * Parses and evaluates the input expression without mutating the registry.
   * Runs the same parse / unknown-var / cycle / eval / finite checks as
   * `setParameter`, but never writes to `entries` or `dependents`. Intended
   * for UI-side validation (e.g. inline dialog errors) where we want to show
   * an error as the user types without polluting the registry state.
   *
   * Returns the computed SketchParameter on success, or an EvaluationError.
   * Note: this does NOT recompute dependents — it only validates the single
   * input expression against the current registry snapshot.
   */
  dryRun(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError> {
    const parsed = this.parseAndValidate(input);
    if (!parsed.ok) return parsed;
    return { ok: true, value: parsed.value.parameter };
  }

  setParameter(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<SketchParameter, EvaluationError> {
    const parsed = this.parseAndValidate(input);
    if (!parsed.ok) return parsed;
    const { parameter, expr, refs } = parsed.value;

    const old = this.entries.get(input.name);

    // Commit
    if (old) {
      for (const r of old.refs) {
        if (!WHITELIST_FNS.has(r)) this.dependents.get(r)?.delete(input.name);
      }
    }
    for (const r of refs) {
      if (WHITELIST_FNS.has(r)) continue;
      if (!this.dependents.has(r)) this.dependents.set(r, new Set());
      this.dependents.get(r)!.add(input.name);
    }
    this.entries.set(input.name, { parameter, expr, refs });

    const affectedRes = this.recomputeDependentsOf(input.name);
    if (!affectedRes.ok) return affectedRes;
    this.emit();
    return { ok: true, value: parameter };
  }

  /**
   * Shared parse + validate + evaluate pipeline used by both `setParameter`
   * and `dryRun`. Does NOT mutate the registry. Returns the parsed Expression,
   * its variable refs, and the resulting SketchParameter on success.
   */
  private parseAndValidate(input: Pick<SketchParameter, 'name' | 'expression' | 'unit'>):
    Result<{ parameter: SketchParameter; expr: Expression; refs: string[] }, EvaluationError> {
    let expr: Expression;
    try {
      expr = this.parser.parse(input.expression);
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }

    const refs = expr.variables();
    const evalContext: Record<string, number | ((...a: number[]) => number)> = {};
    for (const fn of WHITELIST_FNS) {
      evalContext[fn] = Math[fn as 'abs'] as unknown as (...a: number[]) => number;
    }

    // Stage 1: scan raw identifiers to catch non-whitelisted built-ins (e.g. 'sin')
    // that expr-eval silently resolves and therefore never appear in variables().
    const idents = input.expression.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
    for (const ident of idents) {
      if (WHITELIST_FNS.has(ident)) continue;
      if (ident === input.name) continue;
      if (this.entries.has(ident)) continue;
      return { ok: false, error: { code: 'unknown-var', name: ident } };
    }

    // Stage 2: cycle detection — walk forward through refs of each ref to see if
    // any transitively reference back to the new param's name.
    const cycle = this.wouldCauseCycle(input.name, refs);
    if (cycle) {
      return { ok: false, error: { code: 'cycle', namesInCycle: cycle } };
    }

    // Stage 3: compute
    const vars: Record<string, number> = {};
    for (const [name, entry] of this.entries) {
      vars[name] = entry.parameter.value;
    }
    let value: number;
    try {
      value = expr.evaluate({ ...vars, ...evalContext } as Record<string, number>);
    } catch (e) {
      return { ok: false, error: { code: 'parse-error', message: (e as Error).message } };
    }
    if (!Number.isFinite(value)) {
      return { ok: false, error: { code: 'non-finite' } };
    }

    const parameter: SketchParameter = {
      name: input.name,
      expression: input.expression,
      value,
      unit: input.unit
    };
    return { ok: true, value: { parameter, expr, refs } };
  }

  renameParameter(from: string, to: string): Result<void, EvaluationError> {
    if (from === to) return { ok: true, value: undefined };
    if (!this.entries.has(from)) {
      return { ok: false, error: { code: 'unknown-var', name: from } };
    }
    if (this.entries.has(to)) {
      return { ok: false, error: { code: 'name-in-use', name: to } };
    }
    const deps = Array.from(this.dependents.get(from) ?? []);
    const entry = this.entries.get(from)!;
    const savedDepEntries = new Map<string, ParsedEntry>();
    for (const d of deps) {
      const e = this.entries.get(d);
      if (e) savedDepEntries.set(d, e);
    }

    this.entries.delete(from);
    this.entries.set(to, { ...entry, parameter: { ...entry.parameter, name: to } });
    this.dependents.set(to, this.dependents.get(from) ?? new Set());
    this.dependents.delete(from);

    for (const dep of deps) {
      const depEntry = this.entries.get(dep);
      if (!depEntry) continue;
      const newExpr = depEntry.parameter.expression.replace(
        new RegExp(`\\b${escapeRegex(from)}\\b`, 'g'),
        to
      );
      try {
        const reparsed = this.parser.parse(newExpr);
        const refs = reparsed.variables();
        this.entries.set(dep, {
          parameter: { ...depEntry.parameter, expression: newExpr },
          expr: reparsed,
          refs
        });
      } catch {
        // Full rollback: restore top-level rename AND all processed dep entries.
        this.entries.set(from, entry);
        this.entries.delete(to);
        this.dependents.set(from, this.dependents.get(to) ?? new Set());
        this.dependents.delete(to);
        for (const [d, e] of savedDepEntries) this.entries.set(d, e);
        return { ok: false, error: { code: 'parse-error', message: `rewrite failed on ${dep}` } };
      }
    }
    this.emit();
    return { ok: true, value: undefined };
  }

  removeParameter(name: string): Result<void, EvaluationError> {
    const refs = Array.from(this.dependents.get(name) ?? []);
    if (refs.length > 0) {
      return { ok: false, error: { code: 'referenced', name, referencedBy: refs } };
    }
    const entry = this.entries.get(name);
    if (entry) {
      for (const r of entry.refs) {
        if (!WHITELIST_FNS.has(r)) this.dependents.get(r)?.delete(name);
      }
    }
    this.entries.delete(name);
    this.dependents.delete(name);
    this.emit();
    return { ok: true, value: undefined };
  }

  private recomputeDependentsOf(changed: string): Result<void, EvaluationError> {
    const order = this.topologicalOrder(changed);
    for (const name of order) {
      if (name === changed) continue;
      const entry = this.entries.get(name);
      if (!entry) continue;
      const vars: Record<string, number> = {};
      for (const [n, e] of this.entries) vars[n] = e.parameter.value;
      try {
        const evalContext: Record<string, unknown> = { ...vars };
        for (const fn of WHITELIST_FNS) evalContext[fn] = Math[fn as 'abs'];
        const v = entry.expr.evaluate(evalContext as Record<string, number>);
        if (!Number.isFinite(v)) continue;
        entry.parameter.value = v;
      } catch {
        // leave last-known-good
      }
    }
    return { ok: true, value: undefined };
  }

  private wouldCauseCycle(newName: string, newRefs: readonly string[]): string[] | null {
    const walkFrom = (startRef: string): string[] | null => {
      const visited = new Set<string>();
      const stack: string[] = [newName];
      const dfs = (node: string): string[] | null => {
        if (node === newName) return [...stack, node];
        if (visited.has(node)) return null;
        visited.add(node);
        stack.push(node);
        const entry = this.entries.get(node);
        for (const r of entry?.refs ?? []) {
          if (WHITELIST_FNS.has(r)) continue;
          const p = dfs(r);
          if (p) return p;
        }
        stack.pop();
        return null;
      };
      return dfs(startRef);
    };

    for (const r of newRefs) {
      if (WHITELIST_FNS.has(r)) continue;
      if (r === newName) return [newName];
      const p = walkFrom(r);
      if (p) return p;
    }
    return null;
  }

  private topologicalOrder(start: string): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const walk = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);
      order.push(name);
      for (const dep of this.dependents.get(name) ?? []) walk(dep);
    };
    walk(start);
    return order;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
