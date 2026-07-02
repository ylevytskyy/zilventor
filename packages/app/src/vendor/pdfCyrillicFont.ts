import type { jsPDF } from 'jspdf';
import { ROBOTO_REGULAR_TTF_BASE64 } from './robotoRegularTtfBase64';

const CYRILLIC_FONT_FILE = 'Roboto-Regular.ttf';

/** PDF-document font id the embedded Roboto TTF is registered under. */
export const CYRILLIC_FONT_ID = 'RobotoCyrillic';

/** Cyrillic block (covers Ukrainian, incl. Ґ/ґ at U+0490/0491). */
const CYRILLIC_RE = /[Ѐ-ӿ]/;

function hasCyrillic(text: string | string[]): boolean {
  return Array.isArray(text) ? text.some((s) => CYRILLIC_RE.test(s)) : CYRILLIC_RE.test(text);
}

/**
 * Register the embedded Roboto (Cyrillic-capable) TTF on `pdf` and wrap
 * `pdf.text` so any call whose text contains a Cyrillic codepoint switches to
 * it for that call, then reverts to Helvetica ('helvetica','normal') —
 * jsPDF's true default. Pure-ASCII calls never touch the new font and stay
 * byte-identical to unpatched jsPDF output (WinAnsi/Helvetica).
 *
 * Call once, immediately after `new jsPDF(...)`, before any `.text()` calls.
 */
export function installCyrillicFont(pdf: jsPDF): void {
  pdf.addFileToVFS(CYRILLIC_FONT_FILE, ROBOTO_REGULAR_TTF_BASE64);
  pdf.addFont(CYRILLIC_FONT_FILE, CYRILLIC_FONT_ID, 'normal');

  const originalText = pdf.text.bind(pdf);
  pdf.text = ((
    text: string | string[],
    x: number,
    y: number,
    options?: Parameters<typeof originalText>[3],
    transform?: Parameters<typeof originalText>[4]
  ) => {
    if (hasCyrillic(text)) {
      pdf.setFont(CYRILLIC_FONT_ID, 'normal');
      const result = originalText(text, x, y, options, transform);
      pdf.setFont('helvetica', 'normal');
      return result;
    }
    return originalText(text, x, y, options, transform);
  }) as typeof pdf.text;
}
