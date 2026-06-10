import { describe, it, expect, beforeAll } from 'vitest';
import i18n from './index';

describe('i18n config', () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) await i18n.init();
  });

  it('supports en and uk only', () => {
    expect(i18n.options.supportedLngs).toContain('en');
    expect(i18n.options.supportedLngs).toContain('uk');
  });

  it('falls back to en', () => {
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('resolves a known key', () => {
    expect(i18n.t('common.ok')).toBe('OK');
  });

  it('returns Ukrainian after changeLanguage', async () => {
    await i18n.changeLanguage('uk');
    expect(i18n.t('common.cancel')).toBe('Скасувати');
    await i18n.changeLanguage('en');
  });
});
