import type { Rule } from '@zilventor/shared';
import { ParameterRegistry } from '../parameters/ParameterRegistry';
import { evaluateRule } from './ruleEvaluator';

/** Thrown when a rule set forms a cycle (a rule's output feeds another's trigger
 *  in a loop), which would make rule evaluation non-terminating. */
export class RuleCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`rule cycle detected: ${cycle.join(' → ')}`);
    this.name = 'RuleCycleError';
  }
}

/**
 * Detects a cycle in a rule set at the parameter level. Each rule contributes an
 * edge from every trigger parameter to every thenSet target parameter (changing a
 * trigger may set the targets). A cycle in this graph means a rule's output can
 * loop back to fire itself. Returns the cycle path, or null when acyclic.
 */
export function detectRuleCycle(rules: Rule[]): string[] | null {
  const adj = new Map<string, Set<string>>();
  for (const rule of rules) {
    for (const trigger of rule.trigger) {
      let targets = adj.get(trigger);
      if (!targets) {
        targets = new Set();
        adj.set(trigger, targets);
      }
      for (const a of rule.thenSet) targets.add(a.target);
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const dfs = (node: string): string[] | null => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(next);
        return [...stack.slice(idx), next];
      }
      if (c === WHITE) {
        const cyc = dfs(next);
        if (cyc) return cyc;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };

  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const cyc = dfs(node);
      if (cyc) return cyc;
    }
  }
  return null;
}

/**
 * Watches a ParameterRegistry and applies conditional rules when a trigger
 * parameter changes. Registers a single subscriber; on each change it diffs the
 * parameter snapshot, finds rules whose trigger fired, evaluates their condition,
 * and applies thenSet assignments through the registry. A re-entrancy guard
 * ensures the engine's own writes don't recursively re-trigger within a burst.
 */
export class RuleEngine {
  private rules: Rule[] = [];
  private unsubscribe: (() => void) | null = null;
  private applying = false;
  private lastSnapshot: Record<string, number> = {};

  constructor(private readonly registry: ParameterRegistry) {}

  /** Load a rule set. Throws RuleCycleError if the rules contain a cycle. */
  load(rules: Rule[]): void {
    const cycle = detectRuleCycle(rules);
    if (cycle) throw new RuleCycleError(cycle);
    this.rules = rules;
    this.lastSnapshot = this.snapshot();
  }

  /** Begin watching the registry. Idempotent. */
  start(): void {
    if (this.unsubscribe) return;
    this.lastSnapshot = this.snapshot();
    this.unsubscribe = this.registry.subscribe(() => this.onChange());
  }

  /** Stop watching the registry. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private snapshot(): Record<string, number> {
    const snap: Record<string, number> = {};
    for (const p of this.registry.getAll()) snap[p.name] = p.value;
    return snap;
  }

  private onChange(): void {
    if (this.applying) return;
    const next = this.snapshot();

    const changed = new Set<string>();
    for (const name of new Set([...Object.keys(next), ...Object.keys(this.lastSnapshot)])) {
      if (next[name] !== this.lastSnapshot[name]) changed.add(name);
    }
    this.lastSnapshot = next;
    if (changed.size === 0) return;

    this.applying = true;
    try {
      for (const rule of this.rules) {
        if (!rule.trigger.some((t) => changed.has(t))) continue;
        let cond: number | boolean;
        try {
          cond = evaluateRule(rule.condition, next);
        } catch {
          continue; // malformed rule expression — skip, don't break the pipeline
        }
        if (!cond) continue;
        for (const a of rule.thenSet) {
          const existing = this.registry.getAll().find((p) => p.name === a.target);
          const unit = existing?.unit ?? 'mm';
          this.registry.setParameter({ name: a.target, expression: a.expression, unit });
        }
      }
    } finally {
      this.applying = false;
      this.lastSnapshot = this.snapshot();
    }
  }
}
