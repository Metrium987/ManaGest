# R4 — extension points (specification only, no code by owner decision)

CC-DEF-1 / matrix §14. These three rows are **seams that already exist in the product**, written
down so that a later build does not have to guess. Nothing here is implemented, and nothing here
changes behaviour today. T-403 is absent on purpose: « locations » still has no agreed meaning
(OQ-011), and guessing it would pick a schema for the owner.

---

## T-401 — Client portal wrapper (reuses per-document links)

**What exists.** `public_links` grants access to **one** invoice, quote or credit note: 32 random
bytes returned once, only the SHA-256 digest stored, 1–365-day expiry, revocation, and an access log
(view, download, acceptance). `/p/:token` renders it anonymously; a quote can be accepted only while
`sent`, with a conditional update so two clicks cannot both win.

**What a portal adds.** A link scoped to a **client** instead of a document: the client opens one
address and sees their own documents, their balances, and the accept button on the quotes that are
still open. It is the same reading surface, with one row instead of many.

**Shape.** A separate table, `portal_links` (token digest, `client_id`, expiry, `revoked_at`,
`last_used_at`), deliberately **not** a column on `public_links`: a client link and a document link
must never be confusable, because one is a door and the other is a single sheet of paper.

**Security rules, non-negotiable.**
- The token is 32 random bytes, stored hashed, shown once; revocation wins over expiry.
- Every query is scoped by the link's `client_id` in the `WHERE` clause, never filtered afterwards.
- The portal exposes documents and the company's public details only — no internal notes, no other
  clients, no ids the client could replay, no totals of the workspace.
- Acceptance is still restricted to a `sent` quote and still conditional.
- Access is journalled and rate-limited per token and per IP; an unknown token answers the same thing
  as a revoked one to avoid confirming that a client exists.

**Acceptance criteria.** A portal link lists exactly its client's documents; revoking it stops access
immediately (410); a document link cannot be replayed as a portal link and vice versa; the access log
names each view; a viewer-less anonymous surface never leaks a balance of another client.

**Out of scope until a gateway exists:** paying from the portal. That needs T-402's states and a
provider, not this seam.

---

## T-402 — Payment pending/failed states + method registry

**What exists.** A payment is created `completed` (or voided) and settles the invoice immediately;
`payment_allocations` carries the split; `balance` and `paid_total` are recalculated from allocations,
never typed. Methods are a fixed constant list shared with expenses.

**What it adds.** Two things the bank and card flows will need.
1. **States**: `pending → completed | failed`, and `completed → voided` only. A pending payment must
   **not** touch an invoice's balance, must not consume an invoice number, and must not block an edit
   as if money had arrived. A failed payment is kept for traceability, with its reason.
2. **Method registry**: methods become rows (key, label, `requires_reference`, archived, sort) seeded
   from today's constant, exactly like expense categories (T-107) — adding a method is a setting, not
   a deployment.

**Ripple effects to check, not assume.** The reminder pass, the aged balance, the dashboard KPIs, the
bank reconciliation and the CSV exports all read payments; each must filter on `completed` explicitly
rather than on "not deleted". A pending payment that quietly settles an invoice is a money bug.

**Acceptance criteria.** A pending payment leaves the invoice's balance and status untouched and is
invisible to the reminder pass; failing it is journalled with a reason; only `completed` payments count
in totals; a method flagged `requires_reference` refuses an empty reference (422); an archived or
unknown method is refused like an unknown expense category.

---

## T-404 — Command palette

**What exists.** A navigation list, a global search endpoint that already respects permissions (it
does not query a section the session cannot read, and withholds money amounts without
`invoices.read`), and the create routes that the pages already use.

**What it adds.** `Ctrl/Cmd+K`: one input that lists (a) navigation commands, (b) "new …" commands,
(c) matching clients, invoices and quotes. Choosing a command navigates; choosing a record opens its
page. It is a **shortcut layer**, not a second application: it calls the same routes and pages, so no
new write path appears.

**Rules.**
- A command is listed only if the session holds its permission — the same server-side truth the search
  endpoint already returns as `scope`. Hiding is a courtesy; the server still refuses.
- Results are announced (combobox semantics, `aria-activedescendant`), Enter opens, Escape closes and
  restores focus to the trigger.
- The palette never renders money for a session without `invoices.read`.
- No result is cached across sessions.

**Acceptance criteria.** A read-only session sees no write command; typing a client's TAHITI number
finds them; Enter opens the record; Escape restores focus; the count of results is announced to a
screen reader.

---

## T-403 — blocked, deliberately

« Locations » may mean commercial premises, equipment rented out, or an extra address slot on a
document. Each implies a different table. Until the owner answers OQ-011, writing a specification
would be inventing a business model, so this row stays **BLOCKED**.
