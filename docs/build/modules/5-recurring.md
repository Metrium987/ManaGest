# M5 — Recurring engine
**Scope** (sheet `recurring` rows; BK-003; OQ-003 spec): recurring models create child invoices on run; manual run exists (verify + tests); T-104 protected `POST /api/runs/daily` (bearer secret in Secrets, rate-limited, idempotent per Tahiti business day, journaled, dashboard last-run card, manual button); automated reminders ride the same pipeline (T-105) and the automatic-run part of T-002 [VALIDATE LOCALLY caps]. External caller remains owner-side (PQ-1 unanswered; contract spec'd in `10-analyst-suggestions.md`).
**Tests**: idempotent double-run same day = no duplicates; rejections without token; date boundary switch (Pacific/Tahiti); child invoice numbering integrity.
**DoD**: simulated scheduler calls (2× same day) pass; module report; note PQ-1 dependency.
