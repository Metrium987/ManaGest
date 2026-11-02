/**
 * Secondary vendors (C2).
 *
 * Odoo keeps a "vendor pricelist" per product: several suppliers, each with its
 * own price, currency, minimum quantity, lead time and supplier reference, and a
 * priority deciding who is asked first. The order line then takes the price of
 * the vendor actually chosen, instead of the single purchase price stored on the
 * article — which is only ever true for one of them.
 *
 * The rule kept here is the one that avoids a wrong invoice: a price already
 * stated on the line is never overwritten. The pricelist only fills what the
 * buyer left empty, so a negotiated price for this order survives.
 */

export interface VendorLink {
  product_id: string;
  vendor_id: string;
  price: number;
  currency: string;
  moq_milli: number;
  lead_time_days: number;
  vendor_ref: string | null;
  is_preferred: number | boolean;
}

/** The link's price, or the fallback when the vendor quoted nothing usable. */
export function unitPriceFor(link: VendorLink | undefined, fallback = 0): number {
  const price = Math.max(0, Math.round(Number(link?.price ?? 0)));
  return price > 0 ? price : Math.max(0, Math.round(Number(fallback ?? 0)));
}

/**
 * Which vendor to ask first: the one flagged preferred, else the cheapest, then
 * the fastest. Buying at the lowest price is the usual rule; the flag exists for
 * the supplier a business keeps for quality or credit even when dearer.
 */
export function preferredLink(links: VendorLink[]): VendorLink | null {
  if (!links.length) return null;
  const preferred = links.find((link) => Boolean(link.is_preferred));
  if (preferred) return preferred;
  return [...links].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.lead_time_days !== b.lead_time_days) return a.lead_time_days - b.lead_time_days;
    return a.vendor_id.localeCompare(b.vendor_id);
  })[0];
}

export interface PriceableLine {
  product_id?: string | null;
  unit_price: number;
}

/**
 * Fills the unit price of the lines that carry none, from the link of the chosen
 * vendor. Lines without a catalogue reference, lines of another vendor and lines
 * already priced are returned untouched.
 */
export function applyVendorPrices<T extends PriceableLine>(
  lines: T[],
  links: VendorLink[],
  vendorId: string,
): T[] {
  const byProduct = new Map(
    links.filter((link) => link.vendor_id === vendorId).map((link) => [link.product_id, link]),
  );
  return lines.map((line) => {
    if (!line.product_id) return line;
    if (Math.round(Number(line.unit_price ?? 0)) > 0) return line;
    const link = byProduct.get(line.product_id);
    if (!link) return line;
    return { ...line, unit_price: unitPriceFor(link) };
  });
}

/** Product ids carried by a set of lines, without duplicates. */
export function productIdsOf(lines: { product_id?: string | null }[]): string[] {
  return [...new Set(lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)))];
}

/**
 * What the vendor requires to ship: its minimum order quantity, applied to the
 * quantity of the line that concerns it. Returns the shortfall, in milli-units,
 * or 0 when the order is acceptable.
 */
export function moqShortfall(link: VendorLink | undefined, quantityMilli: number): number {
  const moq = Math.max(0, Math.round(Number(link?.moq_milli ?? 0)));
  if (!moq) return 0;
  return Math.max(0, moq - Math.round(Number(quantityMilli ?? 0)));
}
