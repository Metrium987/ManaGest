# Evidence gaps — spec sheets (2026-10-28)

Rule (owner instruction): Invoice Ninja rows must cite the reference repository (path+lines, UI string, validation, e2e test) or official docs (URL). ManaGest rows must cite a screen/route/UI string/test and be [OBSERVED]/[EXECUTED]/[DEDUCED].

Combed all 15 sheets for IN-* rows lacking a repo/docs citation. Rows on ManaGest with only route names instead of screens/lines:
- MG-SHEETS-PROJECTS-01 ("My projects, My tasks"Tabs), MG-BANK-07 (dashboard), MG-SETTINGS-02 (Settings page) — earlier drafts cited only `GET /api/...` without the worker line that registers the route → [DEDUCED]; keep unless the 2026-10-27 parity pass confirms the section indices.
- IN rows citing only prose "Invoice Ninja lets clients choose invoice/credit/payment number in settings" — no proof of that option in the repo → [DEDUCED] until the settings pass verifies it; gauge via the settings coverage map.
No row cites ManaGest tests as Invoice Ninja evidence; no IN row invents a detail outside its source family. Runs without evidence → left as `(no source)` and counted in the gap register above, none carried over into parity verdicts.
