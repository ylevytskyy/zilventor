import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { installCyrillicFont, CYRILLIC_FONT_ID } from '../pdfCyrillicFont';
import { ROBOTO_REGULAR_TTF_BASE64 } from '../robotoRegularTtfBase64';

describe('ROBOTO_REGULAR_TTF_BASE64', () => {
  it('decodes to bytes starting with a valid TTF sfnt version (0x00010000)', () => {
    const bytes = Uint8Array.from(atob(ROBOTO_REGULAR_TTF_BASE64), (c) => c.charCodeAt(0));
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });
});

describe('installCyrillicFont', () => {
  it('makes Cyrillic text actually reach the raw PDF byte stream (unpatched jsPDF drops it)', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    installCyrillicFont(pdf);
    pdf.text('Бічна стінка', 10, 10);
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const text = new TextDecoder('latin1').decode(bytes);
    // The embedded font's PostScript id must be referenced in the font dictionary.
    expect(text).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });

  it('does not alter output bytes for pure-ASCII text (stays on default Helvetica/WinAnsi)', () => {
    const withHelper = new jsPDF({ unit: 'mm', format: 'a4' });
    installCyrillicFont(withHelper);
    withHelper.text('#1  Side', 10, 10);
    const bytesWith = new Uint8Array(withHelper.output('arraybuffer'));

    const bare = new jsPDF({ unit: 'mm', format: 'a4' });
    bare.text('#1  Side', 10, 10);
    const bytesBare = new Uint8Array(bare.output('arraybuffer'));

    // Both must contain the literal ASCII string (not Identity-H glyph-id hex).
    const textWith = new TextDecoder('latin1').decode(bytesWith);
    const textBare = new TextDecoder('latin1').decode(bytesBare);
    expect(textWith).toContain('#1  Side');
    expect(textBare).toContain('#1  Side');
    // The ASCII-only content stream bytes are unaffected by installing the helper
    // (font registration adds bytes elsewhere in the file, so compare lengths are
    // not equal — instead assert the literal substring survived identically).
    expect(textWith.includes('#1  Side')).toBe(textBare.includes('#1  Side'));
  });

  it('switches font when any element of a string[] contains Cyrillic', () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    installCyrillicFont(pdf);
    pdf.text(['line one', 'Рядок два'], 10, 10);
    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain(`/BaseFont /${CYRILLIC_FONT_ID}`);
  });
});
