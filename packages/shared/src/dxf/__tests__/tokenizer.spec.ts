import { describe, it, expect } from 'vitest';
import { tokenize } from '../tokenizer';

describe('tokenize', () => {
  it('pairs each group code with its following value, trimming whitespace', () => {
    const text = ['  0', 'SECTION', '  2', 'ENTITIES', '  0', 'EOF'].join('\n');
    expect(tokenize(text)).toEqual([
      { code: 0, value: 'SECTION' },
      { code: 2, value: 'ENTITIES' },
      { code: 0, value: 'EOF' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = '0\r\nLINE\r\n8\r\n0\r\n';
    expect(tokenize(text)).toEqual([
      { code: 0, value: 'LINE' },
      { code: 8, value: '0' },
    ]);
  });

  it('parses negative and multi-digit codes', () => {
    const text = ['100', 'AcDbEntity', '-3', 'x'].join('\n');
    expect(tokenize(text)).toEqual([
      { code: 100, value: 'AcDbEntity' },
      { code: -3, value: 'x' },
    ]);
  });

  it('returns empty array for empty input and never throws on garbage', () => {
    expect(tokenize('')).toEqual([]);
    expect(() => tokenize('not\na\n@@@\ndxf')).not.toThrow();
  });

  it('ignores a trailing code with no value line', () => {
    const text = ['  0', 'EOF', '  9'].join('\n');
    expect(tokenize(text)).toEqual([{ code: 0, value: 'EOF' }]);
  });
});
