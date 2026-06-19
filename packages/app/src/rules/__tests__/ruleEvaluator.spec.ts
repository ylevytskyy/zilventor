import { describe, it, expect } from 'vitest';
import { evaluateRule, RuleDepthError, RuleEvalError } from '../ruleEvaluator';

describe('evaluateRule — comparisons and conditionals', () => {
  it('evaluates a greater-than comparison to a boolean', () => {
    expect(evaluateRule('width > 600', { width: 700 })).toBe(true);
    expect(evaluateRule('width > 600', { width: 500 })).toBe(false);
  });

  it('evaluates if(cond, a, b)', () => {
    expect(evaluateRule('if(width > 600, 1, 0)', { width: 700 })).toBe(1);
    expect(evaluateRule('if(width > 600, 1, 0)', { width: 500 })).toBe(0);
  });

  it('evaluates and / or / not', () => {
    expect(evaluateRule('width > 600 and depth < 400', { width: 700, depth: 300 })).toBe(true);
    expect(evaluateRule('width > 600 or depth < 400', { width: 100, depth: 300 })).toBe(true);
    expect(evaluateRule('not (width > 600)', { width: 500 })).toBe(true);
  });

  it('evaluates equality comparison', () => {
    expect(evaluateRule('width == 600', { width: 600 })).toBe(true);
  });

  it('evaluates arithmetic with whitelisted math functions', () => {
    expect(evaluateRule('max(width, 600)', { width: 700 })).toBe(700);
    expect(evaluateRule('min(width, 600)', { width: 700 })).toBe(600);
  });
});

describe('evaluateRule — unknown identifier rejection', () => {
  it('rejects a variable not present in the snapshot', () => {
    expect(() => evaluateRule('height > 10', { width: 700 })).toThrow(RuleEvalError);
  });

  it('rejects a non-whitelisted function (e.g. sin)', () => {
    expect(() => evaluateRule('sin(width)', { width: 700 })).toThrow(RuleEvalError);
  });

  it('rejects a syntactically invalid expression', () => {
    expect(() => evaluateRule('width >', { width: 700 })).toThrow(RuleEvalError);
  });
});

describe('evaluateRule — depth guard', () => {
  it('allows up to five nested if() calls', () => {
    const expr = 'if(a>0, if(a>1, if(a>2, if(a>3, if(a>4, 1, 0), 0), 0), 0), 0)';
    expect(() => evaluateRule(expr, { a: 5 })).not.toThrow();
  });

  it('throws RuleDepthError beyond five nested if() calls', () => {
    const expr = 'if(a>0, if(a>1, if(a>2, if(a>3, if(a>4, if(a>5, 1, 0), 0), 0), 0), 0), 0)';
    expect(() => evaluateRule(expr, { a: 6 })).toThrow(RuleDepthError);
  });
});
