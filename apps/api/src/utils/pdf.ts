import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatINR, getStateName } from '@ims/shared';
import PDFDocument from 'pdfkit';

/** Finds assets/fonts both from the source tree (tsx) and from the bundled build (dist). */
function fontDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'assets', 'fonts');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('PDF fonts not found (expected apps/api/assets/fonts)');
}
const FONTS = fontDir();

export const PAGE = { width: 595.28, height: 841.89, margin: 36 };
export const INK = '#0f172a';
export const MUTED = '#475569';
export const RULE = '#cbd5e1';
export const HEAD_FILL = '#f1f5f9';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
export const formatPdfDate = (iso: string) => dateTime.format(new Date(iso));
export const qty = (n: number) => Number(n.toFixed(3)).toLocaleString('en-IN');
export const money = (paise: number) => formatINR(paise).replace('₹', '');
export const stateLabel = (code: string) => `${getStateName(code) ?? 'State'} (${code})`;

export type TextOptions = PDFKit.Mixins.TextOptions & {
  font?: 'regular' | 'bold';
  size?: number;
  color?: string;
};

/**
 * An A4 document with the Inter fonts (which include the ₹ sign) and small drawing helpers.
 * `done` resolves to the finished PDF once `doc.end()` is called.
 */
export function createPdf(info: PDFKit.DocumentInfo) {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, info });
  doc.registerFont('regular', join(FONTS, 'Inter-Regular.otf'));
  doc.registerFont('bold', join(FONTS, 'Inter-SemiBold.otf'));

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const layout = {
    left,
    right,
    width: right - left,
    bottom: PAGE.height - PAGE.margin - 24,
  };

  /** Writes text and returns the y position below it. */
  const text = (value: string, x: number, y: number, opts: TextOptions = {}) => {
    const { font = 'regular', size = 9, color = INK, ...rest } = opts;
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(value, x, y, { lineGap: 1.5, ...rest });
    return doc.y;
  };
  const hr = (y: number, color = RULE) => {
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(color).stroke();
  };

  return { doc, done, text, hr, layout };
}
