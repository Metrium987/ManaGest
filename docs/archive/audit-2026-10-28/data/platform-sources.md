# Platform sources — Freebuff capability sources discovered (2026-10-28)

Instruction applied: search the platform's own sources before declaring any capability unverified. Every place looked and every source found is listed below.

## 1. Platform sources found

**S1 — The agent tool-suite documentation embedded in this chat (the platform's operating instructions for this project).** The most granular source available: the documented contract of each platform tool, verbatim capabilities quoted below.
- `sites_create` — create a Sites project with isolated preview and production environments.
- `sites_add_storage` — "Create a **D1 SQL database** or **R2 object bucket** for a site environment. The name is a Worker binding such as DB or FILES. Deploy after creation; code uses env.DB or env.FILES." ⇒ storage CONFIRMED platform-native (SQL DB + object storage).
- `sites_enable_auth` — "Sign in with Freebuff for a site environment… registers exact deployed callbacks; returns public variables… No client secret is needed." ⇒ auth CONFIRMED.
- `sites_prepare_realtime` — creates realtime helpers; "Add realtime:true to the deploy manifest… Sites provides an isolated env.REALTIME Durable Object binding per environment" ⇒ realtime CONFIRMED.
- `sites_deploy` — "Deploy prebuilt Worker code and static assets from this workspace… JSON manifest: {entrypoint, compatibilityDate, modules[], assetsDirectory, spa:true}"; manifest supports `realtime:true`; **the documented manifest has NO schedule/cron field** ⇒ scheduled execution not offered by the documented deployment surface.
- `sites_set_secret` — "Set or rotate a server-side Worker API key… Sites → Secrets so values stay out of chat" (project limit 25 customer variables) ⇒ secrets management CONFIRMED (platform-native place to hold e.g. an email-provider API key *if the owner approves one*).
- `sites_prepare_next` — builds/bundles Next.js projects (documented adapter flow; irrelevant to the current Hono app but confirms a build pipeline is platform-native).
- `sites_set_published` / `sites_list` / `sites_inspect` — publish/unpublish and inspecting environments ⇒ hosting lifecycle CONFIRMED.
- `cloud_show_dev_server` — dev preview of the app inside the platform browser panel (preview hosting, not an email/export capability).
- `cloud_read_skill` — a platform skill system exists, but **no listing tool exists** in the suite; skills are loadable by name only ⇒ enumerating the account's skills is NOT possible; noted as an attempted-but-closed source.

**S2 — Project platform-configuration artifacts (read, not modified).** `deploy.json` (production manifest: entrypoint, compatibilityDate, modules, assetsDirectory, spa:true — again no scheduling surface), `wrangler.jsonc` (D1 binding, migrations dir allowed, assets binding, SPA fallback) — these corroborate S1: no cron, D1 binding real, asset storage real.

**S3 — Local filesystem discovery (performed 2026-10-28, read-only).** Project root contains `README.md` (project doc, no platform ops content); no `AGENTS.md`/`CLAUDE.md`/guides folder in the project root; `.freebuff` dir absent; `/workspace/chats/homes`, `/workspace/chats/state` and `repo.git` exist but exposing no platform guide files (empty listings for the names searched); no environment variables matched email/cron/export/provider names (only var NAMES were ever read; none relevant found). ⇒ no additional local platform instruction files exist beyond S1.

**S4 — freebuff.com public web (researched 2026-10-28, URLs + dates in the researcher report).** Pages checked: freebuff.com/web, /blog/freebuff-web-launch, /blog/*builder-comparisons, github.com/CodebuffAI/freebuff README; `freebuff.com/docs` = 404, `docs.freebuff.com` does not resolve. Product pages advertise: hosted sandboxes, live previews, one-click production deploy, custom domains, GitHub project connection, built-in database + file storage, sign-in options (Google/GitHub/email magic links). **No public technical documentation found for: outbound email, scheduled jobs, database export/backup, per-file/request upload limits.** ⇒ public docs do not refine S1 on the contested points.

## 2. Consequence table for every previously UNVERIFIED item

| Capability | Sources that answer it | Final verdict (2026-10-28) | Platform-native way when CONFIRMED |
|---|---|---|---|
| SQL database for documents | S1 sites_add_storage, S2 wrangler.jsonc | **CONFIRMED** | sites_add_storage(kind d1) → attach via deploy; code reads env.DB (already how ManaGest runs) |
| Object/file storage | S1 sites_add_storage, S4 launch pages advertise file storage | **CONFIRMED** | sites_add_storage(kind r2) → attach; files via env.FILES |
| Secrets / API-key storage | S1 sites_set_secret, S4 auth description | **CONFIRMED** | Sites → Secrets (or sites_set_secret with an owner-provided private file) |
| Authentication | S1 sites_enable_auth | **CONFIRMED** (not needed for the decision rows; recorded) | Sign in with Freebuff — not applicable while ManaGest runs its own session system |
| Realtime | S1 sites_prepare_realtime | **CONFIRMED** (unused by current scope) | REALTIME binding via manifest realtime:true |
| Scheduled/daily runs | S1 manifest has no schedule field; S4 no docs | **UNSUPPORTED (platform-documented)** | Not available through the documented deployment surface. Fallback: documented manual daily run (operator action) OR owner-approved revisit if the platform adds a trigger |
| Outbound email | S1 no email tool/binding; S4 no docs | **UNSUPPORTED (platform-native)** | Two owner-approved options: (a) external provider called over HTTPS, its API key held in Sites Secrets (platform-native secret storage), (b) the owner's accepted manual fallback (PDF + manual "sent" status) |
| Database export — manual | S1 tool dir has no export tool; S2 package.json ships the wrangler toolchain; S4 none | **CONFIRMED (toolchain) / not platform-official** | Documented runbook using the project's existing wrangler-based toolchain on the D1 database; presented to the owner as a runbook, not as a platform feature |
| Database export — scheduled | S1/S4 none | **UNSUPPORTED** | None; manual runbook is the platform-feasible answer for R1 |
| Per-file/request upload limit | S1 silent; S4 "no documented per-file upload limit" | **UNVERIFIED — last resort (kept per instruction)** | Sources checked: S1 tool docs (silent), S2 manifests (silent), S4 freebuff.com pages (silent). Settles only with a non-destructive probe upload in the running app or an owner/platform answer; until then ManaGest adopts the app-level 10 MB value but stays below any unknown platform ceiling by capping at 10 MB regardless |
| XLSX parsing (import) | app-side dependency, bundled at build | **CONFIRMED (feasible; validate at build)** | In-app library bundled into the Worker bundle; falls back to CSV-only if bundling constraints appear |
