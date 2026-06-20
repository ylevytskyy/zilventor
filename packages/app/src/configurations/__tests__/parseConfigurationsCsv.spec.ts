import { describe, it, expect } from 'vitest';
import { parseConfigurationsCsv } from '../parseConfigurationsCsv';

describe('parseConfigurationsCsv', () => {
  it('parses a 3-row design table into 3 configurations', () => {
    const csv = [
      'name,width,height',
      'Large,900,1200',
      'Medium,600,800',
      'Small,300,400',
    ].join('\n');
    const configs = parseConfigurationsCsv(csv);
    expect(configs).toEqual([
      { name: 'Large', values: { width: '900', height: '1200' } },
      { name: 'Medium', values: { width: '600', height: '800' } },
      { name: 'Small', values: { width: '300', height: '400' } },
    ]);
  });

  it('ignores blank lines and trims surrounding whitespace', () => {
    const csv = '\n name , width \n Big , 1000 \n\n';
    const configs = parseConfigurationsCsv(csv);
    expect(configs).toEqual([{ name: 'Big', values: { width: '1000' } }]);
  });

  it('returns an empty array when there are no data rows', () => {
    expect(parseConfigurationsCsv('name,width')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseConfigurationsCsv('')).toEqual([]);
  });
});
