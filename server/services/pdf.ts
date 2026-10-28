import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { currencyDecimals, fromMinor } from '../lib/money';
import { computeTotals, type LineItem } from '../lib/tax';
import type { CompanyRow } from '../types';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const ACCENT = rgb(0.05, 0.42, 0.47);
const INK = rgb(0.09, 0.15, 0.17);
const MUTED = rgb(0.42, 0.48, 0.49);
const LINE = rgb(0.86, 0.89, 0.89);
const SOFT = rgb(0.96, 0.97, 0.97);

interface PdfContext {
  page: PDFPage;
  y: number;
}

function money(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const value = fromMinor(minor, currency);
  const fixed = value.toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped}${fraction ? `,${fraction}` : ''} ${currency}`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export async function buildInvoicePdf(
  company: CompanyRow,
  invoice: Record<string, unknown>,
  lines: LineItem[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const currency = String(invoice.currency ?? company.currency);
  const totals = computeTotals(
    lines,
    {
      discount_type: (invoice.discount_type as 'percent' | 'amount') ?? 'percent',
      discount_value: Number(invoice.discount_value ?? 0),
    },
    Boolean(invoice.tax_exempt),
  );

  doc.setTitle(`Facture ${invoice.number ?? ''} — ${company.name}`);
  doc.setAuthor(company.name);
  doc.setSubject('Facture');
  doc.setCreator('ManaGest');

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: PdfContext = { page, y: PAGE_H - MARGIN };

  const drawHeader = (target: PDFPage, isFirst: boolean) => {
    target.drawRectangle({ x: 0, y: PAGE_H - 108, width: PAGE_W, height: 108, color: rgb(0.03, 0.2, 0.23) });
    target.drawText(company.name, { x: MARGIN, y: PAGE_H - 58, size: 20, font: bold, color: rgb(1, 1, 1) });
    const subtitle = [company.legal_name, company.city].filter(Boolean).join(' · ');
    if (subtitle) {
      target.drawText(subtitle.slice(0, 90), { x: MARGIN, y: PAGE_H - 78, size: 9, font: regular, color: rgb(0.83, 0.89, 0.89) });
    }
    if (company.tax_id) {
      target.drawText(`Numéro TAHITI : ${company.tax_id}`, {
        x: MARGIN, y: PAGE_H - 92, size: 8, font: regular, color: rgb(0.72, 0.82, 0.82),
      });
    }
    target.drawText(isFirst ? 'FACTURE' : 'FACTURE (suite)', {
      x: PAGE_W - MARGIN - bold.widthOfTextAtSize(isFirst ? 'FACTURE' : 'FACTURE (suite)', 22),
      y: PAGE_H - 58,
      size: 22,
      font: bold,
      color: rgb(1, 1, 1),
    });
    target.drawText(String(invoice.number ?? ''), {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(String(invoice.number ?? ''), 11),
      y: PAGE_H - 76,
      size: 11,
      font: regular,
      color: rgb(0.83, 0.89, 0.89),
    });
  };

  const newPage = () => {
    const next = doc.addPage([PAGE_W, PAGE_H]);
    drawHeader(next, false);
    ctx.page = next;
    ctx.y = PAGE_H - 140;
  };

  drawHeader(page, true);
  ctx.y = PAGE_H - 150;

  const boxWidth = (PAGE_W - MARGIN * 2 - 24) / 2;
  const clientLines = [
    String(invoice.client_name ?? ''),
    String(invoice.client_address1 ?? ''),
    [invoice.client_postal_code, invoice.client_city].filter(Boolean).join(' '),
    String(invoice.client_country ?? ''),
    invoice.client_tax_id ? `TAHITI : ${invoice.client_tax_id}` : '',
  ].filter((value) => value && value !== 'null');

  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 100, width: boxWidth, height: 100, color: SOFT });
  ctx.page.drawText('FACTURÉ À', { x: MARGIN + 12, y: ctx.y - 20, size: 8, font: bold, color: MUTED });
  let clientY = ctx.y - 36;
  for (const value of clientLines.slice(0, 5)) {
    ctx.page.drawText(value.slice(0, 52), { x: MARGIN + 12, y: clientY, size: 9.5, font: regular, color: INK });
    clientY -= 13;
  }

  const metaX = MARGIN + boxWidth + 24;
  ctx.page.drawRectangle({ x: metaX, y: ctx.y - 100, width: boxWidth, height: 100, color: SOFT });
  const metaRows: [string, string][] = [
    ['Date de facture', String(invoice.date ?? '')],
    ['Échéance', String(invoice.due_date ?? '—')],
    ['Bon de commande', String(invoice.po_number ?? '—')],
    ['Devise', currency],
  ];
  let metaY = ctx.y - 24;
  for (const [label, value] of metaRows) {
    ctx.page.drawText(label, { x: metaX + 12, y: metaY, size: 8, font: regular, color: MUTED });
    ctx.page.drawText(value.slice(0, 32), {
      x: metaX + boxWidth - 12 - regular.widthOfTextAtSize(value.slice(0, 32), 9),
      y: metaY, size: 9, font: bold, color: INK,
    });
    metaY -= 20;
  }

  ctx.y -= 124;

  const colDesc = MARGIN;
  const colQty = PAGE_W - MARGIN - 250;
  const colUnit = PAGE_W - MARGIN - 170;
  const colTax = PAGE_W - MARGIN - 95;
  const colTotal = PAGE_W - MARGIN;

  const tableHeader = () => {
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 20, width: PAGE_W - MARGIN * 2, height: 22, color: ACCENT });
    ctx.page.drawText('DÉSIGNATION', { x: colDesc + 6, y: ctx.y - 14, size: 8, font: bold, color: rgb(1, 1, 1) });
    ctx.page.drawText('QTÉ', { x: colQty, y: ctx.y - 14, size: 8, font: bold, color: rgb(1, 1, 1) });
    ctx.page.drawText('P.U. HT', { x: colUnit, y: ctx.y - 14, size: 8, font: bold, color: rgb(1, 1, 1) });
    ctx.page.drawText('TVA', { x: colTax, y: ctx.y - 14, size: 8, font: bold, color: rgb(1, 1, 1) });
    ctx.page.drawText('TOTAL HT', { x: colTotal - bold.widthOfTextAtSize('TOTAL HT', 8), y: ctx.y - 14, size: 8, font: bold, color: rgb(1, 1, 1) });
    ctx.y -= 32;
  };

  tableHeader();

  for (const line of lines) {
    const descriptionLines = wrap(line.description, regular, 9.5, colQty - colDesc - 16);
    const rowHeight = Math.max(20, descriptionLines.length * 12 + 8);
    if (ctx.y - rowHeight < 190) {
      newPage();
      tableHeader();
    }
    let lineY = ctx.y;
    for (const text of descriptionLines) {
      ctx.page.drawText(text, { x: colDesc + 6, y: lineY, size: 9.5, font: regular, color: INK });
      lineY -= 12;
    }
    const baseY = ctx.y;
    const qty = String(line.quantity).replace('.', ',');
    ctx.page.drawText(qty, { x: colQty, y: baseY, size: 9, font: regular, color: INK });
    const unit = money(line.unit_price, currency).replace(` ${currency}`, '');
    ctx.page.drawText(unit, { x: colUnit, y: baseY, size: 9, font: regular, color: INK });
    ctx.page.drawText(`${line.tax_rate} %`, { x: colTax, y: baseY, size: 9, font: regular, color: INK });
    const lineValue = money(Math.round(line.unit_price * line.quantity), currency).replace(` ${currency}`, '');
    ctx.page.drawText(lineValue, {
      x: colTotal - regular.widthOfTextAtSize(lineValue, 9), y: baseY, size: 9, font: regular, color: INK,
    });
    ctx.y -= rowHeight;
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y + 6 }, end: { x: PAGE_W - MARGIN, y: ctx.y + 6 }, thickness: 0.5, color: LINE });
  }

  if (ctx.y < 260) newPage();

  ctx.y -= 10;
  const totalsX = PAGE_W - MARGIN - 230;
  const totalRows: [string, string, boolean?][] = [];
  totalRows.push(['Sous-total HT', money(totals.subtotal, currency)]);
  if (totals.discount_total > 0) {
    totalRows.push(['Remise', `- ${money(totals.discount_total, currency)}`]);
  }
  for (const bucket of totals.tax_buckets) {
    totalRows.push([`TVA ${bucket.rate} %`, money(bucket.amount, currency)]);
  }
  totalRows.push(['Total TTC', money(totals.total, currency), true]);

  for (const [label, value, strong] of totalRows) {
    if (strong) {
      ctx.page.drawRectangle({ x: totalsX, y: ctx.y - 6, width: 230, height: 26, color: ACCENT });
      ctx.page.drawText(label, { x: totalsX + 8, y: ctx.y + 2, size: 10.5, font: bold, color: rgb(1, 1, 1) });
      ctx.page.drawText(value, {
        x: PAGE_W - MARGIN - 8 - bold.widthOfTextAtSize(value, 10.5), y: ctx.y + 2, size: 10.5, font: bold, color: rgb(1, 1, 1),
      });
      ctx.y -= 34;
    } else {
      ctx.page.drawText(label, { x: totalsX + 8, y: ctx.y, size: 9.5, font: regular, color: MUTED });
      ctx.page.drawText(value, {
        x: PAGE_W - MARGIN - 8 - regular.widthOfTextAtSize(value, 9.5), y: ctx.y, size: 9.5, font: regular, color: INK,
      });
      ctx.y -= 16;
    }
  }

  if (Number(invoice.paid_total ?? 0) > 0) {
    ctx.page.drawText(`Déjà réglé : ${money(Number(invoice.paid_total), currency)}`, {
      x: totalsX + 8, y: ctx.y, size: 9, font: regular, color: MUTED,
    });
    ctx.y -= 14;
    ctx.page.drawText(`Solde dû : ${money(Number(invoice.balance), currency)}`, {
      x: totalsX + 8, y: ctx.y, size: 9.5, font: bold, color: INK,
    });
    ctx.y -= 22;
  }

  ctx.y -= 8;
  const notes = invoice.notes ? String(invoice.notes) : '';
  if (notes) {
    ctx.page.drawText('NOTES', { x: MARGIN, y: ctx.y, size: 8, font: bold, color: MUTED });
    ctx.y -= 14;
    for (const text of wrap(notes, regular, 9, PAGE_W - MARGIN * 2)) {
      if (ctx.y < 150) newPage();
      ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size: 9, font: regular, color: INK });
      ctx.y -= 12;
    }
    ctx.y -= 8;
  }

  const terms = invoice.terms ? String(invoice.terms) : company.invoice_terms;
  if (terms) {
    if (ctx.y < 140) newPage();
    ctx.page.drawText('CONDITIONS DE PAIEMENT', { x: MARGIN, y: ctx.y, size: 8, font: bold, color: MUTED });
    ctx.y -= 14;
    for (const text of wrap(terms, regular, 8.5, PAGE_W - MARGIN * 2)) {
      if (ctx.y < 110) newPage();
      ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size: 8.5, font: regular, color: INK });
      ctx.y -= 11;
    }
  }

  const bank = [company.bank_name, company.bank_holder, company.bank_iban ? `IBAN ${company.bank_iban}` : '', company.bank_bic ? `BIC ${company.bank_bic}` : '']
    .filter(Boolean).join(' · ');
  if (bank) {
    ctx.y -= 8;
    if (ctx.y < 120) newPage();
    ctx.page.drawText('COORDONNÉES BANCAIRES', { x: MARGIN, y: ctx.y, size: 8, font: bold, color: MUTED });
    ctx.y -= 14;
    for (const text of wrap(bank, regular, 8.5, PAGE_W - MARGIN * 2)) {
      if (ctx.y < 110) newPage();
      ctx.page.drawText(text, { x: MARGIN, y: ctx.y, size: 8.5, font: regular, color: INK });
      ctx.y -= 11;
    }
  }

  const pages = doc.getPages();
  pages.forEach((target, index) => {
    target.drawLine({ start: { x: MARGIN, y: 78 }, end: { x: PAGE_W - MARGIN, y: 78 }, thickness: 0.5, color: LINE });
    const legal = [
      company.legal_name ?? company.name,
      company.address1,
      [company.postal_code, company.city].filter(Boolean).join(' '),
      company.tax_id ? `Numéro TAHITI ${company.tax_id}` : '',
      company.rcs ? `RCS ${company.rcs}` : '',
      company.share_capital ? `Capital ${company.share_capital}` : '',
      company.legal_notes ?? '',
    ].filter(Boolean).join(' · ');
    const legalLines = wrap(legal, regular, 7, PAGE_W - MARGIN * 2);
    legalLines.slice(0, 3).forEach((text, lineIndex) => {
      target.drawText(text, { x: MARGIN, y: 62 - lineIndex * 9, size: 7, font: regular, color: MUTED });
    });
    const label = `Page ${index + 1} / ${pages.length}`;
    target.drawText(label, {
      x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 7.5), y: 30, size: 7.5, font: regular, color: MUTED,
    });
    target.drawText(company.invoice_footer ?? 'Merci de votre confiance.', {
      x: MARGIN, y: 30, size: 7.5, font: regular, color: MUTED,
    });
  });

  return doc.save();
}
