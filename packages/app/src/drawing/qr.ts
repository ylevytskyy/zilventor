import QRCode from 'qrcode';

export interface QrMatrix {
  /** Width/height of the QR symbol in modules (always odd). */
  size: number;
  /** Row-major bit data; data[r*size+c] is 1 (dark) or 0 (light). */
  data: Uint8Array;
}

/** Minimal jspdf surface drawQr needs — keeps it pure & stub-testable. */
export interface QrPdf {
  setFillColor(r: number, g: number, b: number): void;
  rect(x: number, y: number, w: number, h: number, style: string): void;
}

/** Build the QR bit matrix for `text` (synchronous, deterministic). */
export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: qr.modules.size, data: qr.modules.data };
}

/** Draw the matrix as filled mm-rects starting at (x,y); total side = sizeMm. */
export function drawQr(pdf: QrPdf, m: QrMatrix, x: number, y: number, sizeMm: number): void {
  const moduleMm = sizeMm / m.size;
  pdf.setFillColor(0, 0, 0);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.data[r * m.size + c] === 1) {
        pdf.rect(x + c * moduleMm, y + r * moduleMm, moduleMm, moduleMm, 'F');
      }
    }
  }
}
