# HANDOFF — Dealer Digital (Nexo Dealer)

**Status:** implementation stopped on request. Foundation complete and typecheck-clean. **No UI layer exists yet.**
**Date of handoff:** end of the donor-driven MVP run.
**Workspace:** `C:\Users\juanc\OneDrive\Desktop\Nexo Dealer`
**Git:** the workspace is **not a git repository** (`git status` → `fatal: not a git repository`). Nothing is tracked or committed. All work exists only as files on disk. `git init` was deliberately **not** run because it was not requested.

---

## 1. What was completed

### 1.1 Donor audit (research phase — COMPLETE, evidence-based)

All four donor repositories were inspected over the GitHub REST API and `raw.githubusercontent.com` (the `git` CLI cannot reach GitHub from this machine: `schannel: SEC_E_NO_CREDENTIALS`; PowerShell `Invoke-WebRequest` also fails while Node's fetch/`npm` work).

| # | Donor | License finding | Verdict |
|---|-------|-----------------|---------|
| 1 | `mbeps/car-dealership` | **Apache-2.0** — `LICENSE` file present, GitHub `"license": {"spdx_id": "Apache-2.0"}` | **Only legally reusable donor.** Concepts/patterns adapted with attribution. |
| 2 | `tobiager/Rama-Automotores` | **No LICENSE file**, no `package.json` license field, GitHub `"license": null`. README claims "MIT" with no license text. | Study only. Code **not** copied. |
| 3 | `Volodymyr-Poshchalovskyi/Dealeros-...` | **No LICENSE file**, `package.json` says `ISC` while README badge says MIT — contradictory, no text. | Study only. Code **not** copied. |
| 4 | `ServanKorkmaz/car-dealer-crm` | `package.json` declares MIT but **no LICENSE file**; GitHub `"license": null` | Study only. Code **not** copied. |

**Donor strengths identified (input to architecture):**
- **#1 (Apache-2.0):** the only donor using the target stack — Next.js 16 + TypeScript + Supabase/PostgreSQL + Tailwind 4 + zod + Vitest. Schema layout (`database/001_schema.sql`, `010_functions.sql`, `020_policies.sql`, `030_storage.sql`), RLS policy approach, admin-guard pattern, `TestDriveBooking` partial-unique-slot idea, `CarMake`/`CarColor` lookups, dealership-info/working-hours content model. **Notably: it has no acquisition cost, recon, landed cost, profit, lead pipeline or deal model.**
- **#2:** French amortisation financing math (`lib/financiacion.ts`) and a term→rate table.
- **#3:** the only acquisition-cost model seen (`px_value` + `purchase_price` + `reconditioning_costs` → `total_cost`), an expense→cost roll-up rule, per-vehicle document folder taxonomy (`STK-XXX/{Photos,Documents,Purchase,Sale,Delivery,...}`), investor settlement statement.
- **#4:** the richest concepts — RBAC matrix with **sensitive-field masking** (`maskSensitiveCarFields()` hiding `costPrice`/`profitMargin`/`recondCost` from sales), margin/aging pricing rules, `marketComps`, audit log, external-registry lookup **with cache** (same shape as VIN decode), RLS helper functions, contract render/PDF. Defect worth avoiding: it stores money as `varchar`.

**Traccar:** Apache-2.0. REST API on port 8082, auth via session cookie / HTTP Basic / bearer token, live WebSocket at `/api/socket` emitting `{devices, positions, events}`. **None of the four donors contains any GPS code** — this integration is greenfield.

**Net licensing decision:** only donor #1 is compatible. Nothing was copied wholesale from any donor. See §5 for the module-by-module KEEP/ADAPT/REIMPLEMENT/REJECT decision.

### 1.2 Technology decision (LOCKED, not to be revisited)

- Next.js **16.3.5** (App Router) + React **19.3.0** + TypeScript **5.9.3** + Tailwind CSS **4.3.3**
- PostgreSQL via **Prisma 6.19.3** (client + CLI pinned in lockstep)
- **zod 4.6.2**, **jose 6.2.12**, **bcryptjs 3.0.3**, **Vitest 5**, **ESLint 9 + eslint-config-next 16.3.5**
- Self-contained server-side auth (httpOnly cookie + DB-backed session). No Supabase project is assumed to exist, so the app is runnable without external accounts; Supabase remains the recommended production Postgres host and RLS policies are shipped as a migration.
- Vercel-compatible: no long-running processes, no local-only assumptions in app code.

### 1.3 Database layer (COMPLETE)

- `prisma/schema.prisma` — the canonical model, 30 enums, 20 models. **Validated: `prisma generate` succeeded.**
- `prisma/migrations/0001_init/migration.sql` — 779 lines, generated offline with `prisma migrate diff --from-empty --to-schema-datamodel` (no database needed).
- `prisma/migrations/0002_integrity_constraints/migration.sql` — hand-written database-level guards.
- `prisma/migrations/0003_rls_and_public_surface/migration.sql` — RLS + public catalog views + grants.

### 1.4 Domain logic (COMPLETE, pure, deterministic, no AI)

| Module | Purpose |
|--------|---------|
| `src/lib/money.ts` | Integer-cents primitives. All money is `Int` cents — never float, never `Decimal`. Parsing, formatting, basis points. |
| `src/lib/economics.ts` | **The** economics engine: `computeLandedCost`, `computeEstimatedGrossProfit`, `computeActualGrossProfit`, `computeRoiBasisPoints`, `computeDaysInInventory`, `computeVehicleEconomics`, `rollUpInventory`. Pure integer arithmetic, no I/O. |
| `src/lib/sourcing.ts` | `evaluateSourcingCandidate` → landed cost, expected profit/ROI, **maximum purchase price**, **max bid**, and a deterministic `BUY`/`WATCH`/`PASS` with written-out reasons. |
| `src/lib/finance.ts` | Amortised payment estimator (0% APR degrades to `P/ n`), term/APR clamping with warnings, Texas trade-in-taxable logic, mandatory "estimate only, not an approval" disclaimer. |
| `src/lib/vehicle-status.ts` | 12-status lifecycle state machine with an explicit allowed-transition table, `assertTransition`, terminal/publicly-visible sets, `deriveListingStatus`, status tones. |

### 1.5 Security (COMPLETE for the server layer)

- `src/lib/auth/password.ts` — bcrypt cost 12 + a server-side strength policy.
- `src/lib/auth/session.ts` — 32-byte random token in an httpOnly/SameSite=Lax/Secure-in-prod cookie; the DB stores only the **SHA-256 hash**; server-side revocable sessions; request-memoised lookup; **fails closed** on any error.
- `src/lib/auth/roles.ts` — 25-capability matrix across 5 roles (OWNER/MANAGER/SALES/RECON/VIEWER). `finance:read` is a distinct capability from `pricing:read`, so cost basis and margin can be withheld from sales while still letting them quote.
- `src/lib/auth/guards.ts` — `requireStaff`/`requireCapability` (redirect for pages) vs `authorize`/`authorizeAny` (throw for actions/route handlers), plus **`maskVehicleFinancials()`** which strips cost/margin fields server-side before serialization to a client component.
- `src/lib/storage.ts` — upload hardening: size ceilings, **magic-byte content sniffing** (never trusts the declared MIME), extension allow-list, SVG rejected (script carrier), generated storage keys (so path traversal and attacker-chosen filenames are impossible), path-escape assertion on write.
- `src/lib/action-result.ts` — typed `ActionResult`, friendly mapping of Prisma `P2002`/`P2004` violations, and a generic message for unexpected errors so internal details never reach the browser.
- `prisma/migrations/0003_...sql` — deny-by-default RLS on every customer/lead/deal/money/document/session table; **anon gets no access to base tables at all**, only to three read-only views that project the public columns (RLS is row-level, so granting anon `SELECT` on `vehicles` would have leaked `minimum_approved_cents` and acquisition cost). Grants and `security_invoker=false` are wrapped in `DO` blocks guarded by role/version checks so the migration also runs on plain PostgreSQL.
- HTTP security headers in `next.config.ts` (`nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`).

### 1.6 External-provider architecture (COMPLETE as interfaces)

- `src/lib/providers/types.ts` — contracts for VIN decode, vehicle history, valuation, auction feed, lender, GPS. Rule stated in-file: return `unavailable` rather than inventing data.
- `src/lib/providers/vin-decode.ts` — a **real** integration with the NHTSA vPIC public API (no key, no scraping), VIN normalisation, I/O/Q exclusion, timeout handling, `missingFields` reporting.
- `src/lib/providers/traccar.ts` — real Traccar REST client; disabled unless `TRACCAR_BASE_URL` + `TRACCAR_API_TOKEN` are set; resource paths are config-overridable.
- `src/lib/providers/registry.ts` — Carfax/AutoCheck, KBB/Black Book/MMR, Manheim/Copart/IAA, Facebook Marketplace and lenders are all modelled as **explicitly unconfigured**, each stating the credential a real integration would need.

### 1.7 Toolchain plumbing (COMPLETE)

- `.npmrc` — moves npm's cache **inside the workspace** (`cache=./.npm-cache`). Required: the default cache lives in `%LOCALAPPDATA%` and is outside the file sandbox, which produced `EPERM` on every install.
- `package.json` scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:watch`, `db:generate`, `db:migrate`, `db:deploy`, `db:seed`.
- `.env` + `.env.example` (documented, every optional integration commented out), `.gitignore` (excludes `src/generated/`, `.npm-cache/`, `.env`, uploads).

---

## 2. What is partially completed

| Item | State |
|------|-------|
| `DONOR_AUDIT.md` | **Not written as a file.** The full audit content is in §1.1 of this handoff and in `HANDOFF.md` only. Required by the original brief as a standalone deliverable. |
| Architecture decision record (KEEP/ADAPT/REIMPLEMENT/REJECT) | **Not written as a file.** Captured in §5 below. |
| README | **Not written.** |
| `eslint.config.mjs` | **Missing**, though `package.json` declares `lint: eslint .`. `npm run lint` therefore **fails right now** (no config found). |
| Prisma → app wiring | `src/lib/db.ts` and the client exist, but **no query code was written** — no repository/service layer, no data access functions. |
| `src/lib` UI helpers | Enum→label maps (needed by every screen) and `getDealerSettings()` were **not** written. |
| Migrations applied | **Never executed against a database.** No PostgreSQL server is reachable from this machine. The SQL is generated but unproven. |

---

## 3. What remains from the original request

Everything in the P0/P1/P2 lists that is not §1.3–1.7 above. Concretely, **zero user-facing code exists**:

- **No `src/app/` directory at all** → `next build` **will fail** (Next.js requires an app or pages directory).
- Customer storefront: home, inventory catalog, search/sort/filter, vehicle detail (gallery, financing estimate UI, CTAs), favorites, trade-in intake form, financing page, lead capture, test-drive request, reservation intent.
- Admin: login page + login action (guards redirect to `/admin/login`, which does not exist yet), dashboard, inventory CRUD, acquisition, recon, expenses, CRM (customers/leads/tasks/activities), sales/deals, reservations, documents, sourcing inbox, settings, integrations status page, denied page.
- Server actions for every mutation.
- Public-facing route handlers: `/api/files/[...key]` (upload serving), lead/test-drive/trade-in endpoints.
- UI component library + design system (Tailwind theme, layout, nav, cards, tables, forms).
- `middleware.ts` (cookie-presence redirect only — explicitly **not** the security boundary).
- Tests: the brief requires landed cost, gross profit, ROI, max bid, inventory transitions, reservation conflicts, customer/lead relationships and authorization boundaries. **No test files exist**, so `npm test` will currently report "no test files found" and exit non-zero.
- Seed script (`prisma/seed.ts`, referenced by `db:seed`) with `dataOrigin: DEMO` rows and the demo-data banner.
- `DONOR_AUDIT.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `README.md`, `ATTRIBUTIONS.md` (Apache-2.0 NOTICE obligations for donor #1 concepts).
- P3 items (auction/marketplace/lender/Carfax integrations, webDEALER, full accounting) are correctly **not** started.

---

## 4. Files created

### Configuration (9)
`package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.npmrc`, `.gitignore`, `.env`, `.env.example`

### Database (4)
`prisma/schema.prisma`
`prisma/migrations/0001_init/migration.sql`
`prisma/migrations/0002_integrity_constraints/migration.sql`
`prisma/migrations/0003_rls_and_public_surface/migration.sql`

### Domain + infrastructure (17)
`src/lib/money.ts`, `src/lib/economics.ts`, `src/lib/sourcing.ts`, `src/lib/finance.ts`, `src/lib/vehicle-status.ts`, `src/lib/utils.ts`, `src/lib/storage.ts`, `src/lib/action-result.ts`, `src/lib/db.ts`
`src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/roles.ts`, `src/lib/auth/guards.ts`
`src/lib/providers/types.ts`, `src/lib/providers/vin-decode.ts`, `src/lib/providers/traccar.ts`, `src/lib/providers/registry.ts`

### Generated (not hand-written, gitignored)
`src/generated/prisma/**` (Prisma client, v6.19.3)

**No files were modified or deleted. Nothing was reverted.**

---

## 5. Architecture and important decisions

### 5.1 Module-by-module decision (the required KEEP / ADAPT / REIMPLEMENT / REJECT)

**KEEP (as architecture, in our own codebase):**
- Target stack: TypeScript + Next.js App Router + PostgreSQL. Donor #1 already used it; no migration was performed to satisfy a preference.
- Layered SQL migration files with a numbered prefix.
- Deny-by-default RLS with a separate public projection for the catalog.

**ADAPT (concept from a donor, reimplemented by us):**
- From #1 (Apache-2.0): RLS policy discipline; the server-side admin guard pattern; zod schema validation at boundaries; a booking-style partial-unique index (we applied the idea to **reservations and live deals**); make/colour lookup tables became plain denormalised vehicle columns (a single Texas dealership does not need a normalised make table).
- From #3: the acquisition-cost roll-up concept and the per-vehicle document taxonomy — reimplemented with integer cents and a strict single-owner rule per cost.
- From #4: RBAC with sensitive-field masking → `maskVehicleFinancials()`; external lookup + cache shape → the VIN-decode adapter.
- From #2: the amortisation formula and term→rate configuration → `src/lib/finance.ts`.

**REIMPLEMENT (no donor had it, or the donor version was unusable):**
- The vehicle economics engine, sourcing intelligence (max bid / BUY-WATCH-PASS), the vehicle lifecycle state machine, the CRM/lead-pipeline/deal/reservation model, document tracking, the public storefront and the entire admin surface.
- Justification: **no donor had a landed-cost or ROI engine**, **no donor had a lead pipeline**, and donors #2–#4 are license-blocked. Reimplementing was both legally and architecturally correct.

**REJECT:**
- Wholesale merging of any repository.
- Donors #2, #3 and #4 as sources of copied code (no license / contradictory license claims).
- Donor #3's 597 KB single-file HTML UI, committed SQLite binary, Excel trial artefacts; donor #4's ~120 Replit prompt assets, duplicate admin portal, orphaned Python and three parallel auth implementations; donor #2's 72 KB inline admin component and placeholder PDF route returning fake data.
- Donor #1's demo content ("Maruf Motors", fake address/phone/logo), its multi-dealer marketplace framing and `numberPlate`/`seats` fields; its `FOR ALL USING (true)`-style permissive shortcuts.
- Donor #2's plaintext-password `admin_users` table.
- Donor #4's `varchar` money columns.

### 5.2 Canonical-model decisions

- **ONE vehicle model.** 12 lifecycle statuses exactly as specified; `listing_status` is derived from lifecycle status so the two cannot drift.
- **ONE customer model and ONE lead/deal model.** No second CRM.
- **ONE acquisition-candidate model.** `SourcingCandidate` serves both the sourcing inbox and trade-in intake (`source: TRADE_IN_SUBMISSION`), so trade-ins cannot fork into a parallel system.
- **Costs have exactly one home** — this is the most important invariant in the system:
  - purchase price, auction fees, transportation, inspection, other → `Vehicle` acquisition fields
  - recon → `VehicleReconItem` rows (or an explicit `reconOverrideCents`)
  - everything else → `Expense` rows, whose `ExpenseCategory` enum **deliberately excludes** auction fee / transport / inspection / recon
  - Consequence: double counting is structurally impossible rather than merely discouraged.
- **Money is integer cents everywhere** (`Int` columns). Exact arithmetic, safe JSON serialization, no `Decimal`/float drift.
- **ROI is always basis points**, and `null` when landed cost is 0 — a fake `0%` is never displayed.
- **No fabrication:** the schema has no accident-history, condition-grade, warranty, inspection-result, market-value or approval fields, because we have no licensed source for them. Financing stores estimator configuration, and states "estimate only".

### 5.3 Database constraints worth knowing (migration 0002)

- `reservations_one_active_per_vehicle` — partial unique index; the DB itself prevents two active reservations on one car.
- `deals_one_live_per_vehicle` — same idea for deals.
- `vehicles_sold_requires_final_price`, `deals_contracted_requires_sale_price` — a "sold" car must record what it sold for.
- `vehicles_active_listing_requires_price` — the public catalog can never show a $0 vehicle.
- `leads_lost_has_reason`, `customers_has_contact`, `vehicles_tracker_coordinates_paired`, `saved_vehicles_single_owner`, non-negative-money and range checks on every monetary/enum column.

### 5.4 Texas / webDEALER boundary

`OfficialWorkflowStatus` (`NOT_STARTED` … `SUBMITTED_EXTERNALLY`, `COMPLETED`, `REJECTED`, `NOT_APPLICABLE`) on the Deal for title work and registration. The app stores **staff-reported** progress only. No Texas legal form is invented and nothing is submitted to TxDMV or webDEALER. Titles/registration remain official-system functions.

### 5.5 GPS boundary

`trackerDeviceId`, `trackerStatus`, last position and geofence state live on the vehicle but are **excluded from the public view** and never required to list or sell a car. Credentials are server-only.

---

## 6. Database / schema changes

**Additive only. No prior schema existed** (the workspace was completely empty at the start; there was no repository, branch or HEAD to inspect).

30 enums, 20 models/tables:
`users`, `sessions`, `audit_logs`, `vehicles`, `vehicle_photos`, `vehicle_status_events`, `vehicle_recon_items`, `expenses`, `customers`, `leads`, `lead_activities`, `deals`, `reservations`, `test_drive_requests`, `saved_vehicles`, `deal_documents`, `sourcing_candidates`, `tasks`, `dealer_settings`.
3 public views: `public_vehicle_listings`, `public_vehicle_photos`, `public_vehicle_availability`.

**The `dealer_settings` singleton has not been seeded** — `getDealerSettings()` and the bootstrap row still need to be written.

---

## 7. Tests / validation already performed

| Check | Command | Result |
|-------|---------|--------|
| Prisma schema validity | `npx prisma generate` | ✅ **PASS** — "Generated Prisma Client (v6.19.3)" |
| Migration SQL generation | `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` | ✅ **PASS** — 779-line migration produced without a database |
| Typecheck | `npx tsc --noEmit` | ✅ **PASS, exit code 0** (3 real errors found and fixed: an invalid `eslint` key in `next.config.ts`, and two unsound `as` casts in `providers/traccar.ts`) |
| Dependency install | `npm install` | ✅ **PASS** — 738 dev packages + runtime deps |
| Git status | `git status` | ⚠️ **Not a git repository** — nothing tracked, nothing committed |
| Lint | `npm run lint` | ❌ **NOT RUNNABLE** — no `eslint.config.mjs` exists |
| Unit tests | `npm test` | ❌ **NOT RUN** — no test files exist |
| Production build | `npm run build` | ❌ **NOT RUN** — and it will fail: there is no `src/app/` directory |
| Migrations applied to a live DB | — | ❌ **NOT RUN** — no PostgreSQL reachable |

**Environment constraints discovered (important for whoever continues):**

1. **`git` cannot reach GitHub** and PowerShell `Invoke-WebRequest` fails on TLS (`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`). Node's `fetch`/`npm` **do** work. Use the `web_fetch` tool or Node for network work.
2. **npm needs its cache inside the workspace** (`.npmrc` → `cache=./.npm-cache`); the default cache is outside the sandbox and returns `EPERM`.
3. **npm's `postinstall` scripts are blocked by the confined sandbox** (`spawn EPERM` from esbuild / workerd / unrs-resolver / Prisma engines) and required a one-shot escalation to `danger-full-access`. Any future install, and `prisma migrate diff`, likely needs the same.
4. **`git`/npm state is not preserved across tool calls** — each shell invocation is a fresh process; pass `workdir`.

---

## 8. Known issues and blockers

1. **No UI layer → `next build` fails.** This is the single biggest gap. Nothing is runnable end-to-end yet.
2. **`eslint.config.mjs` missing** → `npm run lint` fails before it lints anything.
3. **No tests** → `npm test` exits non-zero ("no test files found").
4. **Latent client-bundle hazard:** `src/lib/action-result.ts` imports `AuthorizationError` from `src/lib/auth/guards.ts`, and `guards.ts` imports `next/navigation` **and** `session.ts` (which imports `next/headers` + Prisma). If a client component imports `action-result.ts`, server-only modules get pulled toward the client bundle. Fix by moving the error class into a leaf module (e.g. `src/lib/auth/errors.ts`) and removing the import from `action-result.ts`.
5. **`src/lib/providers/registry.ts`** builds its `unavailable` reason with a repeated `this.availability()` call and a cast. It typechecks and works, but is clumsy and should be simplified.
6. **Migration SQL is unproven.** 0002/0003 were hand-written and have never been executed. Specifically unverified: the partial unique indexes, the `CHECK` constraints (which are strict enough that the app must set `finalSalePriceCents` before a `SOLD` transition and `lostReason` before a `LOST` lead), and the `security_invoker` `DO` block.
7. **`prisma` was pinned to 6.19.3 deliberately.** A plain `npm install -D prisma` resolved `8.0.0-rc.13` while `@prisma/client` resolved `^7.10.0` — a mismatched, pre-release pair. Do not "upgrade" casually.
8. **No `middleware.ts` yet.** When written it must only check cookie *presence* and redirect; it runs on the edge runtime where Prisma is unavailable, and it must never become the authorization boundary.
9. **No demo-data honesty mechanism is wired yet.** `VehicleDataOrigin.DEMO` and `DealerSettings.demoMode` exist in the schema, and the public view exposes `data_origin` so the UI can badge demo inventory — but nothing renders that badge yet, and `prisma/seed.ts` does not exist.
10. **`DONOR_AUDIT.md` / `README.md` / `docs/` were never written.** The brief requires `DONOR_AUDIT.md` as a deliverable; its content is preserved in §1.1 and §5 here.

---

## 9. Exact recommended next task

**Create a git repository and commit the current state as the baseline, before writing any more code.**

```powershell
cd "C:\Users\juanc\OneDrive\Desktop\Nexo Dealer"
git init
git add -A          # .gitignore already excludes src/generated, .npm-cache, .env, var/uploads
git commit -m "chore: foundation — schema, migrations, economics engine, auth, providers"
git branch -M main
```

Rationale: ~30 hand-written files of validated foundation currently exist **only** as loose files in a non-repository directory. This is the highest-risk item in the project and the cheapest to eliminate. Verify the commit does **not** contain `.env` before moving on.

**Immediately after that, in this order:**

1. Fix issue #4 (move `AuthorizationError` to a leaf module) — it is a one-file change that prevents a confusing build failure later.
2. Write `eslint.config.mjs` so `npm run lint` works, and add `src/lib/labels.ts` (enum→label maps) + `src/lib/settings.ts` (`getDealerSettings()` singleton bootstrap) — every screen needs both.
3. Write the smallest runnable vertical slice: `src/app/layout.tsx` + `globals.css` (Tailwind 4 `@theme`), a placeholder `src/app/page.tsx`, and `src/app/admin/login/page.tsx` with its server action — this makes `next build` pass and makes the guards in `guards.ts` reachable for the first time.
4. Write `tests/` for the engine **before** building screens: `economics.test.ts` (landed cost, gross profit, ROI, days-in-inventory, recon override vs items), `vehicle-status.test.ts` (legal/illegal transitions, terminal states), `sourcing.test.ts` (max purchase price / max bid / BUY-WATCH-PASS, including the zero-landed-cost `null` ROI case), `finance.test.ts` (0% APR, clamping), `auth/roles.test.ts` (capability matrix, `maskVehicleFinancials`).
5. Start PostgreSQL, run `prisma migrate dev`, and prove migrations 0001–0003 apply cleanly. Until this passes, the schema is only a hypothesis.
6. Then build the P0 surfaces: public catalog + vehicle detail, admin inventory CRUD, lead capture.

---

## 10. Verdict

**DEALER MVP PARTIALLY COMPLETE — foundation only (schema, migrations, economics engine, sourcing intelligence, auth/RBAC, provider adapters, security and upload hardening). No UI, no tests, no seed, no applied migrations; `next build` cannot succeed until an `src/app/` layer exists.**

Nothing was pushed. Nothing was deployed. Nothing was reverted.
