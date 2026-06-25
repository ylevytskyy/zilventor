import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import uk from '../locales/uk.json';

type Locale = Record<string, unknown>;

function getPath(o: Locale, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc != null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, o);
}

describe('i18n — hardware import keys', () => {
  const keys = [
    'dialog.hardware.import.button',
    'dialog.hardware.import.error',
    'dialog.hardware.import.success',
  ] as const;

  it.each(keys)('en.json has truthy key %s', (key) => {
    expect(getPath(en as Locale, key)).toBeTruthy();
  });

  it.each(keys)('uk.json has truthy key %s', (key) => {
    expect(getPath(uk as Locale, key)).toBeTruthy();
  });
});
