import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { computeTotals, type LineItem } from '../lib/tax';
import { money, wrap } from './pdf';
import { styleFor, type DocLayout } from './pdf-style';
import type { CompanyRow } from '../types';

/**
 * T-108a (BK-015 groundwork): quote and credit-note PDFs. They share the
 * invoice's typography and wording rules — including the TVA status sentence —
 * but carry their own title, dates and totals labels. Kept separate from the
 * invoice builder so the invoice layout cannot regress.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const ACCENT = rgb(0.05, 0.42, 0.47);
const INK = rgb(0.09, 0.15, 0.17);
const MUTED = rgb(0.42, 0.48, 0.49);
const LINE = rgb(0.86, 0.89, 0.89);

export type DocumentKind = 'quote' | 'credit';

export interface DocumentInput {
  number: string | null;
  date: string;
  /** Validity for a quote, status label otherwise. */
  secondary: string | null;
  currency: string;
  line_items: LineItem[];
  discount_type: string;
  discount_value: number;
  discount_total: number;
  subtotal: number;
  tax_total: number;
  total: number;
  tax_exempt: number | boolean;
  notes: string | null;
  terms: string | null;
  client: {
    name: string;
    address1: string | null;
    address2: string | null;
    city: string | null;
    postal_code: string | null;
    country: string | null;
    tax_id: string | null;
  };
}

const TITLES: Record<DocumentKind, string> = { quote: 'DEVIS', credit: 'AVOIR' };
const SECONDARY_LABELS: Record<DocumentKind, string> = { quote: 'VALABLE JUSQU’AU', credit: 'STATUT' };
const TOTAL_LABELS: Record<DocumentKind, string> = { quote: 'Total TTC', credit: 'Total avoir' };

export async function buildDocumentPdf(
  kind: DocumentKind,
  company: CompanyRow,
  doc: DocumentInput,
  layout: DocLayout = 'classic',
): Promise<Uint8Array> {
  const style = styleFor(layout);
  const compact = layout === 'compact';
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const text = (value: string, options: { x: number; y: number; size?: number; font?: typeof regular; color?: typeof INK }) => {
    page.drawText(value, {
      x: options.x,
      y: options.y,
      size: options.size ?? 9.5,
      font: options.font ?? regular,
      color: options.color ?? INK,
    });
  };

  // Header: full band in the classic layout, a thin rule in the compact one.
  const titleSize = compact ? 14 : 20;
  if (style.band) {
    page.drawRectangle({ x: 0, y: PAGE_H - 118, width: PAGE_W, height: 118, color: ACCENT });
  } else {
    page.drawLine({ start: { x: MARGIN, y: PAGE_H - 104 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - 104 }, thickness: 2, color: ACCENT });
  }
  const headingColor = style.band ? rgb(1, 1, 1) : INK;
  const bodyColor = style.band ? rgb(1, 1, 1) : MUTED;
  text(company.name, { x: MARGIN, y: PAGE_H - 52, size: compact ? 14 : 16, font: bold, color: headingColor });
  const companyLines = [
    company.address1,
    [company.postal_code, company.city].filter(Boolean).join(' '),
    company.tax_id ? `TAHITI ${company.tax_id}` : null,
    company.email,
  ].filter((value): value is string => Boolean(value));
  companyLines.slice(0, 3).forEach((value, index) => {
    text(value, { x: MARGIN, y: PAGE_H - 70 - index * 12, size: 8.5, color: bodyColor });
  });

  text(TITLES[kind], { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(TITLES[kind], titleSize), y: PAGE_H - 52, size: titleSize, font: bold, color: headingColor });
  if (doc.number) {
    text(doc.number, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(doc.number, 11), y: PAGE_H - 70, size: 11, font: bold, color: headingColor });
  }
  const issued = `Émis le ${doc.date}`;
  text(issued, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(issued, 8.5), y: PAGE_H - 84, size: 8.5, color: bodyColor });

  y = PAGE_H - 150;

  // Client block
  text('ÉTABLI POUR', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y -= 16;
  text(doc.client.name, { x: MARGIN, y, size: 11, font: bold });
  y -= 14;
  const clientLines = [
    doc.client.address1,
    doc.client.address2,
    [doc.client.postal_code, doc.client.city].filter(Boolean).join(' '),
    doc.client.country,
    doc.client.tax_id ? `TAHITI ${doc.client.tax_id}` : null,
  ].filter((value): value is string => Boolean(value));
  for (const value of clientLines) {
    text(value, { x: MARGIN, y, size: 9, color: MUTED });
    y -= 12;
  }

  if (doc.secondary) {
    text(SECONDARY_LABELS[kind], { x: PAGE_W - MARGIN - 150, y: PAGE_H - 166, size: 8, font: bold, color: MUTED });
    text(doc.secondary, { x: PAGE_W - MARGIN - 150, y: PAGE_H - 180, size: 10 });
  }

  y -= 18;

  // Line table
  const colDesc = MARGIN;
  const colQty = PAGE_W - MARGIN - 250;
  const colUnit = PAGE_W - MARGIN - 170;
  const colTax = PAGE_W - MARGIN - 95;
  const colTotal = PAGE_W - MARGIN;
  const tableHeader = () => {
    const headColor = style.tableHeaderFill ? rgb(1, 1, 1) : ACCENT;
    if (style.tableHeaderFill) {
      page.drawRectangle({ x: MARGIN, y: y - 20, width: PAGE_W - MARGIN * 2, height: 22, color: ACCENT });
    } else {
      page.drawLine({ start: { x: MARGIN, y: y - 20 }, end: { x: PAGE_W - MARGIN, y: y - 20 }, thickness: 1, color: ACCENT });
    }
    text('DÉSIGNATION', { x: colDesc + 6, y: y - 14, size: 8, font: bold, color: headColor });
    text('QTÉ', { x: colQty, y: y - 14, size: 8, font: bold, color: headColor });
    text('P.U. HT', { x: colUnit, y: y - 14, size: 8, font: bold, color: headColor });
    text('TVA', { x: colTax, y: y - 14, size: 8, font: bold, color: headColor });
    text('TOTAL HT', { x: colTotal - bold.widthOfTextAtSize('TOTAL HT', 8), y: y - 14, size: 8, font: bold, color: headColor });
    y -= 32;
  };
  tableHeader();

  doc.line_items.forEach((line) => {
    const descriptionLines = wrap(line.description, regular, 9.5, colQty - colDesc - 16);
    const rowHeight = Math.max(20, descriptionLines.length * 12 + 8);
    if (y - rowHeight < 210) {
      newPage();
      tableHeader();
    }
    let lineY = y;
    for (const value of descriptionLines) {
      text(value, { x: colDesc + 6, y: lineY, size: 9.5 });
      lineY -= 12;
    }
    text(String(line.quantity).replace('.', ','), { x: colQty, y, size: 9 });
    text(money(line.unit_price, doc.currency).replace(` ${doc.currency}`, ''), { x: colUnit, y, size: 9 });
    text(line.tax_status === 'exempt' ? 'Exonéré' : `${line.tax_rate} %`, { x: colTax, y, size: 9 });
    const lineValue = money(Math.round(line.unit_price * line.quantity), doc.currency).replace(` ${doc.currency}`, '');
    text(lineValue, { x: colTotal - regular.widthOfTextAtSize(lineValue, 9), y, size: 9 });
    y -= rowHeight;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 }, thickness: 0.5, color: LINE });
  });

  if (y < 260) newPage();
  y -= 10;

  const totalsX = PAGE_W - MARGIN - 230;
  const rows: [string, string, boolean?][] = [['Sous-total HT', money(doc.subtotal, doc.currency)]];
  if (doc.discount_total > 0) rows.push(['Remise', `- ${money(doc.discount_total, doc.currency)}`]);
  for (const bucket of computeTotals(doc.line_items, {
    discount_type: doc.discount_type === 'amount' ? 'amount' : 'percent',
    discount_value: doc.discount_value,
  }, Boolean(doc.tax_exempt)).tax_buckets) {
    rows.push([`TVA ${bucket.rate} %`, money(bucket.amount, doc.currency)]);
  }
  rows.push([TOTAL_LABELS[kind], money(doc.total, doc.currency), true]);

  for (const [label, value, strong] of rows) {
    if (strong) {
      if (style.totalsBlock) {
        page.drawRectangle({ x: totalsX, y: y - 6, width: 230, height: 26, color: ACCENT });
        text(label, { x: totalsX + 8, y: y + 2, size: 10.5, font: bold, color: rgb(1, 1, 1) });
        text(value, { x: PAGE_W - MARGIN - 8 - bold.widthOfTextAtSize(value, 10.5), y: y + 2, size: 10.5, font: bold, color: rgb(1, 1, 1) });
      } else {
        page.drawLine({ start: { x: totalsX, y: y + 12 }, end: { x: PAGE_W - MARGIN, y: y + 12 }, thickness: 1, color: ACCENT });
        text(label, { x: totalsX + 8, y, size: 11, font: bold, color: INK });
        text(value, { x: PAGE_W - MARGIN - 8 - bold.widthOfTextAtSize(value, 11), y, size: 11, font: bold, color: INK });
      }
      y -= 34;
    } else {
      text(label, { x: totalsX + 8, y, size: 9.5, color: MUTED });
      text(value, { x: PAGE_W - MARGIN - 8 - regular.widthOfTextAtSize(value, 9.5), y, size: 9.5 });
      y -= 16;
    }
  }

  const mentions: string[] = [];
  const taxMention = String(company.legal_notes ?? '').trim();
  if (taxMention) mentions.push(taxMention);
  if (kind === 'credit' && doc.notes) mentions.push(doc.notes);
  if (kind === 'credit' && !doc.notes) mentions.unshift('Avoir établi sur un document déjà facturé.');

  y -= 10;
  for (const mention of mentions) {
    if (y < 150) newPage();
    for (const value of wrap(mention, regular, 8.5, PAGE_W - MARGIN * 2)) {
      if (y < 110) newPage();
      text(value, { x: MARGIN, y, size: 8.5, color: MUTED });
      y -= 11;
    }
    y -= 6;
  }

  if (kind === 'quote' && doc.terms) {
    if (y < 150) newPage();
    text('CONDITIONS', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
    y -= 14;
    for (const value of wrap(doc.terms, regular, 8.5, PAGE_W - MARGIN * 2)) {
      if (y < 110) newPage();
      text(value, { x: MARGIN, y, size: 8.5 });
      y -= 11;
    }
  }

  const footer = String(company.invoice_footer ?? '').trim();
  if (footer) {
    text(footer, { x: MARGIN, y: 40, size: 8, color: MUTED });
  }
  text(`${TITLES[kind]} ${doc.number ?? ''}`.trim(), { x: PAGE_W - MARGIN - 100, y: 40, size: 8, color: MUTED });

  return pdf.save();
}
