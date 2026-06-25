import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import uk from '../locales/uk.json';

describe('i18n — tandem slide system keys', () => {
  it('en.json has slideSystem keys under dialog.drawerBank', () => {
    const db = (en as unknown as Record<string, Record<string, Record<string, string>>>).dialog?.drawerBank;
    expect(db?.slideSystem).toBeDefined();
    expect(db?.slideSystemSideMount).toBeDefined();
    expect(db?.slideSystemTandem).toBeDefined();
  });

  it('uk.json has slideSystem keys under dialog.drawerBank', () => {
    const db = (uk as unknown as Record<string, Record<string, Record<string, string>>>).dialog?.drawerBank;
    expect(db?.slideSystem).toBeDefined();
    expect(db?.slideSystemSideMount).toBeDefined();
    expect(db?.slideSystemTandem).toBeDefined();
  });
});
