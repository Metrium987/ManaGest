# M1 — Permissions & roles core
**Scope** (`CC-RC` enforcement; `17 §R-C`): fixed-role permission matrix surfaced and enforced server-side (existing `requirePermission` extended covering every mutation incl. future endpoints); test helper for uniform 403/200 assertions; audit test sweep T-008; button gating policy (T-203, disabled-with-French-message); custom roles (T-202) BLOCKED-BY OQ-021.
**Steps**: 1) enumerate current coverage (`13-route-matrix.md`) and add missing checks; 2) write `assertPermission` API test helper; 3) per-route negative tests; 4) UI gating helper (visible-disabled + reason key); 5) admin role matrix screen (read-only until OQ-021 answer) — R3.
**Screens**: Users page (existing), role matrix read-only view (R-B).
**Permissions**: users/roles = admin only; every change journaled.
**Tests**: per-permission denial matrix; journal entries for permission changes.
**DoD**: full negative-test matrix green; any unguarded route found during sweep becomes a defect row fixed in-module.
