# Build spec — Import & Export (« Importer / Exporter ») — OQ-015, release R1

Owner decision: do not wait for any specific source system; support the most popular widely-used formats. Recorded here as a build specification; the R1 backlog row references this sheet.

## 1. Import (template-driven)
- **Formats**: CSV (UTF-8, header row required; delimiter auto-detected between `,` and `;`, stated in the preview), and XLSX *if the platform allows it* (capability UNVERIFIED — see `09` §Platform capabilities; CSV alone satisfies R1).
- **Templates**: one downloadable template per entity — Clients, Products (first phase), then Invoices (later phase). Each template contains the exact column names, a `required/optional` marker row or annotation, the accepted values (e.g. country names from the local list; category codes; yes/no booleans; ISO date `YYYY-MM-DD`), and 2–3 example rows that pass validation.
- **Import flow (5 steps)**:
  1. Choose entity → download template (or export current data as a starting point).
  2. Upload file (size/type validated; errors rejected with a French message).
  3. **Preview** — parsed rows shown; column mapping auto-checked against header names; row-level validation errors listed with row number + field + reason (French). Invalid rows are highlighted, never silently dropped.
  4. Confirm — **no partial silent import**: either all rows import or the user excludes the rows still in error (explicit choice in the confirm dialog).
  5. Result report — created / updated counts, skipped rows, generated document numbers listed.
- **Insert/update rule**: match on unique key (clients: email or client number; products: product key) — a matching row updates, a new row inserts. Duplicate keys inside one file are reported as errors in preview.
- **Invoices phase**: lines come as one row per line item with the shared invoice fields repeated on each line; header/line grouping documented in the template.

## 2. Export (round-trip)
- Every list screen (and reports) gets an **Exporter** button writing the current filter as a CSV file (UTF-8 with BOM, `;` delimiter for French Excel friendliness — same delimiter families as import).
- Exported column names and value encodings are **identical to the import templates**, so an exported file can be re-imported unchanged (round-trip requirement, OQ-015).
- Numbers export as display-independent values (raw minor-unit amounts in a dedicated column family, per the money spec in `03`), dates as ISO.

## 3. Validation & error behaviour (rules)
- GIVEN a file with a duplicate unique key WHEN previewed THEN both rows flagged, import blocked until resolved.
- GIVEN a row with a required field empty WHEN previewed THEN the row is marked invalid with the field named; nothing imports silently.
- GIVEN an invalid encoding/mime WHEN uploaded THEN rejected before parsing begins.
- GIVEN a template column missing WHEN previewed THEN mapping error names the missing column.

## 4. Verdict & evidence
- ManaGest today: none of the above exists (`MISSING`, planned R1 — parity row PAR-IMPEXP-001).
- Platform: XLSX-parsing support UNVERIFIED; CSV path platform-independent.
