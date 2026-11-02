/**
 * Every value presented for one cookie name, in header order.
 *
 * A browser can hold several cookies with the same name at once — for example a
 * partitioned (CHIPS) cookie issued by an earlier deployment next to the plain
 * one — and sends them all in a single `Cookie` header. Reading only the first
 * match authenticates the dead copy and locks a perfectly valid session out, so
 * callers try each candidate in turn.
 */
export function cookieValues(header: string, name: string): string[] {
  const values: string[] = [];
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const raw = pair.slice(separator + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      value = raw;
    }
    if (value) values.push(value);
  }
  return values;
}
