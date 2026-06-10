import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import i18n from './index';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(cleanup);

describe('LanguageSwitcher', () => {
  it('renders EN and UK choices', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByRole('button', { name: /EN/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /UK|УК/ })).toBeTruthy();
  });

  it('changes the active language on click', async () => {
    await i18n.changeLanguage('en');
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /UK|УК/ }));
    expect(i18n.language).toBe('uk');
    await i18n.changeLanguage('en');
  });
});
