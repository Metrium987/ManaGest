/**
 * Legal identifiers printed on a Polynesian document.
 *
 * French Polynesia uses three identifiers that do not replace one another: the
 * **numéro TAHITI** (tax identification), the **RIDET** (business register) and
 * the **NIF** (fiscal number issued by the DICP). A party may hold one, two or
 * three of them, so each line is printed only when the value exists and nothing
 * is ever made mandatory by the template.
 */

export interface PartyIdentifiers {
  tax_id?: string | null;
  ridet?: string | null;
  nif?: string | null;
}

/** One line per identifier the party actually has. */
export function identifierMentions(party: PartyIdentifiers): string[] {
  const lines: string[] = [];
  if (party.tax_id) lines.push(`Numéro TAHITI : ${party.tax_id}`);
  if (party.ridet) lines.push(`RIDET : ${party.ridet}`);
  if (party.nif) lines.push(`NIF : ${party.nif}`);
  return lines;
}

/** The three identifiers on one line, for a header or a footer. */
export function identifierLine(party: PartyIdentifiers): string {
  return identifierMentions(party)
    .map((line) => line.replace(' : ', ' '))
    .join(' · ');
}
