# NEXO AUTO — PHASE 9 CANONICAL HANDOFF

**Repository:** `juancarmonam0-crypto/NexoAuto`
**Branch:** `main`
**Document status:** evidence document. Every claim below was verified by inspecting the working tree, the
database catalogs, the test runners and the build output on the date of writing. Where a requested feature did
not survive implementation it is marked **NOT IMPLEMENTED — <reason>**. Nothing in this document is written
because a prompt asked for it.

**Scope covered:** Phase 8.5 (backend capability surface audit), Phase 9A (operator experience expansion),
Phase 9B (deal structuring, payment modes and finance engine), Phase 9C (Deal Desk frontend).

**Supersedes:** `HANDOFF.md`, which describes the Phase 1–2 foundation and is stale in two material ways: it
states the workspace is not a git repository (it is, with four commits of history) and that "no UI layer exists
yet" (there is a full operator UI plus a public catalog).

---

## SECTION 1 — REPOSITORY STATE

| Item | Value (verified) |
|---|---|
| Repository | `juancarmonam0-crypto/NexoAuto` |
| Branch | `main` |
| **Base HEAD** (the commit all Phase 9 work sits on) | `2266fe95f7bfcc51a62627a2414da58ff897d005` — `fix(build): generate prisma client during install and build` |
| **Phase 9 commit** | All of Phase 9A / 9B / 9C / 9D plus this document are landed in **one** commit on top of that base: `feat(dealer): complete deal desk and finance workflows`. The commit's own SHA is created by the commit itself, so it is not stated here; it is reported in the release note that accompanies it. Before that commit, the whole cycle sat uncommitted in the working tree (Phases 8.5–9C were explicitly "do not commit"). |
| Commit history before Phase 9 | `2266fe9` → `9b369cd` (`fix(ui): harden dealer workflow and accessibility`) → `8415412` (`feat(ui): redesign Nexo Auto interface`) → `2f3584a` |
| Remote | `origin/main` was confirmed identical to the base HEAD (`0` ahead / `0` behind) immediately before the push, so the push is a fast-forward. |
| Deployment | Last proven Vercel deployment before Phase 9: `6412675` for `2266fe9` = `success`. The production URLs answer **HTTP 401 "Protected deployment"** (Vercel Authentication enabled on Production), so public smoke tests cannot run without a Vercel session or `VERCEL_TOKEN`, neither of which exists in this workspace. |
| **Production database** | Untouched. Migration `0006` was **not** applied to Supabase, no production data was mutated and no seeding ran. The push is code only. |
| Deployment vs database | **BUILD/DEPLOY SUCCESS IS NOT PRODUCTION DATABASE READY.** The pushed code expects columns created by `0006`; until that migration is applied deliberately in a separate step, the two routes that read stored deal terms render an explicit "migration pending" notice instead of failing (see Section 10). |

**Framework / runtime versions that matter to this work** (from `package.json` / `package-lock.json`):

| Component | Version |
|---|---|
| Next.js | 16.3.5 (App Router, Turbopack, React 19.3) |
| TypeScript | 5.9, `strict: true` (no `exactOptionalPropertyTypes`) |
| Prisma | 6.19.3 (client generated to `src/generated/prisma`, which is gitignored) |
| Tailwind CSS | 4 (`@import "tailwindcss"`) |
| Vitest | 5 (unit + a separate integration config) |
| zod | 4.6.2 |

---

## SECTION 2 — PHASE 8.5 AUDIT (what existed before any of this UI/engine work)

Phase 8.5 produced a **chat report, not a repository file**: no audit document exists on disk (the only markdown
files are `AI_STUDIO_UI_CONTRACT.md`, `HANDOFF.md` and the untracked `NEXO_AUTO_ARCHITECTURE.md`). The headline
numbers below are reproduced as recorded at the time; the underlying capability list is re-derivable from
`src/lib/operations/*` and `src/app/actions/*`, which is what Phase 9A then acted on.

**Headline: 91 discrete capabilities audited.**

| Classification | Count | Meaning |
|---|---|---|
| FULL | 32 | Complete backend path *and* a frontend representation |
| PARTIAL | 8 | Real but incomplete (e.g. create without update) |
| HIDDEN | 23 | Fully implemented on the server, **no UI at all** |
| INTERNAL | 4 | Deliberately not user-facing (masking, error mapping, runtime plumbing) |
| BLOCKED | 24 | Requires a schema/domain extension or an external system that does not exist |
| True gaps (no code at all) | 4 | expense edit/delete, vehicle archive/delete, an audit-log writer, and a deals read that returns buyer/fees |

**The critical findings that shaped Phases 9A–9C**

1. **Eight server actions were fully implemented and completely unreachable from any screen**:
   `evaluateOpportunityAction`, `updateSourcingCandidateAction`, `decodeVinAction`,
   `updateVehicleAcquisitionAction`, `updateReconItemAction`, `updateLeadContactAction`,
   `updateLeadDetailsAction`, `addLeadNoteAction`.
2. **Two fields were unassignable end-to-end**: `Vehicle.features` and `Vehicle.titleStatus` existed in the
   schema and were rendered by the public catalog, but no action accepted them.
3. **The LOST lead transition was unreachable**: no UI ever sent `lostReason`, so both the operation and the
   database constraint `leads_lost_has_reason` refused every attempt to lose a lead.
4. **Deal terms were unreadable**: `liveDealForVehicle` returned only `{ id, status, customerId }`.
5. **Audit, reservation, test-drive, saved-vehicle and document models had no operations at all.**

---

## SECTION 3 — PHASE 9A: EXISTING BACKEND SURFACED

Phase 9A added **no new backend capability** except three already-accepted fields forwarded by a thin action.
Everything else was an existing operation given a deliberate frontend representation. Primary navigation stayed
**BUY / CARS / LEADS / SALES**.

### BUY

| Backend operation / model | Frontend representation | Role behaviour |
|---|---|---|
| `evaluateOpportunityAction` | Deal analyzer "Analyze" — scores without saving | `sourcing:read` |
| `decodeVinAction` | "Decode" (NHTSA vPIC) fills identity fields; reports provider refusal honestly | `sourcing:read` |
| `createSourcingCandidateAction` | "Save opportunity" | `sourcing:write` |
| `updateSourcingCandidateAction` | Per-candidate "Revise inputs & re-score" | `sourcing:write` |
| `recordSourcingDecisionAction` | Per-candidate decision **plus the decision note** (previously uncollectable) | `sourcing:write` |
| `acquireVehicleAction` | Acquire form grew from **6 to 18 real fields** | `sourcing:write` |
| `listSourcingCandidates` filters | Status and verdict filter chips | `sourcing:read` |

### CARS

| Backend operation / model | Frontend representation | Role behaviour |
|---|---|---|
| `getVehicleDetail` | Vehicle command centre with eight URL-driven tabs: overview, economics, recon, expenses, photos, deal, documents, history | `inventory:read` |
| `updateVehicleDetailsAction` | Now collects `titleStatus` and `features` (**P0 closed**) | `inventory:write` |
| `updateVehicleAcquisitionAction` | Economics tab (was unused) | `pricing:write` |
| `updateReconItemAction` | Recon tab completion flow: status + actual cost (was unused) | `recon:write` |
| `recordVehicleExpenseAction` | Expense form now carries `description` | `expenses:write` |
| `listInventory` fields | `daysInInventory`, `acquisitionSource`, consistent `masked` chips | masked by `finance:read` |

### LEADS

| Backend operation / model | Frontend representation | Role behaviour |
|---|---|---|
| `getLead` | **New lead workspace** `/leads/[leadId]`: activity timeline, contact card, details | `crm:read` |
| `updateLeadStatusAction` | Legal transitions only, via `allowedLeadTransitions`; **`lostReason` required when LOST is reachable (P0 closed)** | `crm:write` |
| `updateLeadContactAction` / `updateLeadDetailsAction` / `addLeadNoteAction` | Workspace forms (all three were unused) | `crm:write` |
| `listLeads` filters | Search, open-only and per-status views | `crm:read` |
| `createLeadAction` | Intake gained `preferredContact`, `nextFollowUpAt`, customer `notes` | `crm:write` |

### SALES

| Backend operation / model | Frontend representation | Role behaviour |
|---|---|---|
| `completeVehicleSaleAction` | Sale form gained `saleDate`, `notes`, `preferredContact` and lead attribution | `deals:write` |
| `cancelDealAction` | Unwind controls on live deals | `deals:write` |
| `liveDealForVehicle` | Deal state per vehicle (Phase 9B replaced it, see below) | `deals:read` |

### NEW BACKEND CAPABILITY IN 9A (complete list)

Exactly one tracked backend file changed: `src/app/actions/cars.ts` (+15 lines) forwarding `titleStatus`,
`features` and `acquisitionSource` to operations that already accepted them. **No new operation, no schema
change, no migration.**

---

## SECTION 4 — PHASE 9B: THE CANONICAL DEAL AND FINANCE ENGINE

Phase 9B is the only phase that changed the database. It adds a deterministic, integer-cents deal-structuring
engine, a versioned rate-policy boundary, persistence for a structured deal, and a read that exposes it.

### 4.1 Payment modes actually implemented

Only modes the code proves are listed. `FinanceType` already contained `CASH`, `FINANCE`, `LEASE`,
`BUY_HERE_PAY_HERE`, `UNDECIDED`; the audit determined that `FINANCE` is already sufficient for external
finance (a lender is named in `lenderName`), but that **lease-to-own is a genuinely different product** — it
transfers ownership, has a different total customer outlay and different residual exposure — so one enum value,
`LEASE_TO_OWN`, was added rather than recording it as a lease and losing it in reporting.

| Mode | Implemented | How it is modelled |
|---|---|---|
| `CASH` | YES | Settles in full at delivery. Rate 0, no term, no schedule, no finance charge, no exposure. Records the cash collected and the tax. |
| `EXTERNAL_FINANCE` (`FINANCE`) | YES | Standard amortisation. The lender advances the financed balance, so dealer exposure is 0 and cash at closing is the full amount due less any trade-in payoff. |
| `BUY_HERE_PAY_HERE` | YES | Same amortisation, but the dealer keeps the financed principal exposed, and the finance charge is projected finance income. |
| `LEASE` | YES | True lease arithmetic (see 4.4), **not** a loan formula. |
| `LEASE_TO_OWN` | YES as data + calculation; **contract generation BLOCKED** | Lease structure with a purchase option; the engine returns `contractGeneration: "BLOCKED"` and `ownershipTransfer: "NOT_DEFINED"` because ownership-transfer and disclosure semantics are not defined. |

### 4.2 Vehicle price engine (`computeRecommendedPricing`)

Derived from landed cost, the dealership's own floors, an optional market reference, an optional ageing policy
and an optional negotiation allowance:

```
minimum approved = ceil(max(landed + min gross, landed x (1 + min ROI)), whole dollars)
target           = ceil(max(landed + target gross | landed x (1 + target ROI), minimum approved))
asking           = target + negotiation allowance - ageing discount
                   capped by the market reference, floored at the minimum approved price
```

Returns the asking, target and minimum-approved tiers, each with its gross and ROI (computed by the existing
`src/lib/economics.ts` helpers, never re-derived), plus the binding constraint and a written explanation. A
market reference below the minimum approved price is reported (`belowMarketTarget`, warning) rather than
silently resolved by pricing above the market.

### 4.3 Amortisation engine (`buildAmortizationSchedule`)

Standard retail instalment arithmetic. The engine walks the schedule period by period: interest is
`round(opening balance x i)` each period, the level payment is applied, and the **final payment is whatever
clears the balance exactly**. Consequently, by construction:

```
closing balance of the last period = 0
financeCharge   = SUM(row interest)
totalOfPayments = amountFinanced + financeCharge     (cent-exact)
totalOfPayments = SUM(row payments)
```

Supported frequencies: MONTHLY (12), SEMIMONTHLY (24), **BIWEEKLY (26, not 24)**, WEEKLY (52). Supported terms
from 1 month upward; `finance.ts` keeps its public estimator clamping, the engine never clamps a rate.

### 4.4 Lease arithmetic (`buildLeaseSchedule`) — deliberately not a loan

```
depreciation = adjusted cap cost - residual
rent charge  = (adjusted cap cost + residual) x money factor x n
payment      = depreciation / n + (adjusted cap cost + residual) x money factor
```

The rent charge is levied on the **average outstanding balance**, which is what makes a lease cheaper than
financing the same amount. The money factor is stored as an APR-equivalent in integer basis points
(`APR bps = money factor x 240,000`, so 0.000625 ↔ 150 bps), keeping one rate representation in the schema. The
same final-payment-drift rule applies, so `totalOfPayments = depreciation + rentCharge` exactly.

### 4.5 What a structure reports

Per structure: amount financed, periodic payment, final payment, number of payments, finance charge, total of
payments, total customer outlay (and outlay including a lease purchase option), **dealer cash received at
closing**, **dealer capital still exposed**, vehicle gross, whether that gross is realised at closing,
projected finance income, term, frequency, first payment date, risk flags and a written explanation.

### 4.6 VEHICLE GROSS vs FINANCE INCOME — kept separate (verified)

This is the invariant the phase exists to protect:

* `vehicleGrossCents = sellingPrice − landedCost`. It is **not** a function of APR, term, down payment or
  finance charge; the test suite changes only the APR and asserts the gross is unchanged.
* `projectedFinanceIncomeCents = the finance charge on the note`. A separate field.
* Neither is ever stored merged. `combinedExpectedEconomicsCents` exists **only** so structures can be ranked
  against each other; it is presentation-only, is never persisted, and must never be recorded or reported as
  "gross profit" or "profit". This is stated in the module header.

### 4.7 Recommendation / ranking engine

Each structure is scored on seven dimensions (0–1000 each): capital velocity, immediate cash recovery, margin,
capital exposure, credit risk, term length, and **risk-adjusted** finance income (the finance charge discounted
by the credit-risk dimension — so a 24% buy-here-pay-here note does not automatically win). Default weights
(basis points, summing to 10,000) put capital velocity (2,500) and immediate cash recovery (2,000) above
margin (2,000) and finance income (1,000), which is why external finance normally wins.

Ranking is deterministic: score descending, then the fixed mode order — so the result never depends on the
order the caller passed the structures in (asserted). The recommendation output is a headline
(`RECOMMENDED: EXTERNAL FINANCE`) plus sentences generated **only** from the winner's own fields. Those
sentences deliberately contain **no cost figure**, because they are shown to roles that are masked out of the
cost basis.

### 4.8 Rounding rules

* Every stored money value is an integer number of cents. The compounding factor `(1+i)^n` is the only
  floating-point intermediate, and it is rounded to whole cents before it becomes a monetary value.
* `Math.round` is the only rounding rule in the engine (half up), so results are identical on every platform.
* Price floors round **up** to whole dollars; ceilings in the sourcing engine round **down**.
* The final scheduled payment absorbs all rounding, bounded by `finalPaymentDriftBoundCents()` (see 4.12).

### 4.9 Rate-policy architecture

`src/lib/rate-policy.ts` implements a **configurable, versioned** boundary: `FinanceRatePolicy` carries
`id`, `jurisdiction`, `effectiveFrom`, `effectiveTo`, `vehicleAgeMaxYears`, `vehicleClass`, `maxAprBasisPoints`
and mandatory source metadata (`label`, `reference`, `retrievedOn`).

* `FINANCE_RATE_POLICIES` ships **empty**. The software asserts no jurisdiction's ceiling; a test asserts the
  registry length is 0.
* Selection is deterministic: jurisdiction match, effective window (`effectiveFrom` inclusive,
  `effectiveTo` exclusive), vehicle age/class scope, then the **most specific** scope, then the most recently
  effective policy, then the lowest id.
* `evaluateFinanceRate` returns the selected APR, the configured ceiling,
  `withinConfiguredRatePolicy: true | false | null` (null = nothing configured) and the status
  `WITHIN_CONFIGURED_RATE_POLICY` / `ABOVE_CONFIGURED_RATE_POLICY` / `NO_CONFIGURED_RATE_POLICY`.
* The language is enforced by test: no returned statement or the shared disclaimer may claim legal
  compliance, and the disclaimer states that this is a configured-policy check, not a legal determination.
* The software does **not** assume a jurisdiction. The write path consults a jurisdiction only when one is
  supplied (the action defaults it from `DealerSettings.state` so the guardrail cannot be bypassed by leaving a
  field blank), and the operation refuses to persist a rate above a **configured** ceiling.

### 4.10 Persistence (the write path)

`completeVehicleSale` now accepts an optional `terms` object and, when a financed mode is supplied with the
terms needed to schedule it, builds the contract through the canonical engine and persists it in the same
transaction that marks the vehicle SOLD. This file performs **no amortisation arithmetic of its own**.

Honest degradation: a financed sale recorded **without** terms persists no structured fields at all (rather
than invented ones), exactly as before Phase 9B. A cash sale records what was collected.

`getLiveDealForVehicle` is the read that makes the persisted deal visible: contract terms, buyer name, dealer
fees, tax, trade-in and payoff, the whole payment schedule, the lease block, official title/registration
status, dates, notes and the rate-policy snapshot.

### 4.11 Defects found and fixed during Phase 9B validation

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 1 | **A cash sale could not be completed at all.** The engine reported `termMonths: 0` / `numberOfPayments: 0` and the operation persisted those zeros; PostgreSQL rejected the insert (`deals_term_sane`, then `deals_payment_schedule_sane`). | DB integration tests | "No term" and "no schedule" are stored as NULL; zero is not a term |
| 2 | `computeLevelPaymentCents` had **no rate-ceiling guard** and silently clamped negative rates — contradicting the module's own rule 3. It computed a $93,537.55 payment at 100.01% APR. | Delegated unit tests | Ceiling and negativity guards added |
| 3 | `computeSalesTaxCents` returned **NaN** for a NaN rate (`Math.max(0, NaN)` is NaN), poisoning `amountDue`/`amountFinanced`. | Delegated unit tests | Finiteness check first; unusable rate = no tax |
| 4 | `compareDealStructures` accepted a `scoring` argument and **discarded it**, silently ranking on defaults. | Delegated unit tests | Weights are threaded into every structure it builds |
| 5 | The documented final-payment drift bound (`numberOfPayments / 2`) was **false**: per-period rounding feeds back into the balance and is amplified by the rate (48 months at 24% drifts 27¢; 84 months drifts 97¢). | Delegated unit tests (724 violating combinations found) | The documentation was corrected and the real bound derived and exported as `finalPaymentDriftBoundCents(n, aprBps, freq)` |
| 6 | Migration 0006 created the enum label `SEMICONTHLY` while the Prisma schema said `SEMIMONTHLY` — it would have failed at runtime the first time a semi-monthly deal was stored. | TypeScript error in a test file, then catalog inspection | Migration corrected; `prisma migrate diff` now reports **"No difference detected"** between the chain and the schema |

### 4.12 Invariants (each asserted by tests)

1. `totalOfPaymentsCents = amountFinancedCents + financeChargeCents` — cent-exact, and enforced by the database
   constraint `deals_payments_arithmetic`.
2. `totalOfPaymentsCents = Σ row payments`; `financeChargeCents = Σ row interest`.
3. The last row's closing balance is exactly 0.
4. At 0% APR the finance charge is exactly 0.
5. No payment is ever negative.
6. Zero amount financed produces no rows and no finance charge.
7. `amountFinanced = max(0, amountDue − down payment − trade-in allowance)`; it is never negative.
8. Lease: `amountFinanced = depreciation` and `totalOfPayments = depreciation + rent charge`.
9. `minimumApproved ≤ target ≤ asking`, and the asking price never falls below the minimum approved price.
10. Vehicle gross is independent of the financing terms; finance income is a separate field.
11. A masked viewer (`landedCostCents: null`) receives `vehicleGrossCents: null`, no score, no ranking — and
    never a gross computed against a cost of zero.

### 4.13 Phase 9D — the inverse solvers (`src/lib/payment-solver.ts`)

The Phase 9B engine answers the forward question ("given these terms, what is the payment?"). Phase 9D adds the
two inverse questions an operator actually asks, **without adding a second amortisation implementation**:

* `maxPrincipalForPaymentCents(target, apr, periods, frequency)` is a **binary search over the canonical
  forward function** `computeLevelPaymentCents`. It does not invert the annuity formula by hand and it does not
  approximate: it repeatedly asks the one engine what the payment would be at a candidate principal and
  bisects to the exact boundary. `target x periods` is a valid upper bound because that is the principal at 0%
  APR and any positive rate supports strictly less. Tests assert BOTH halves of the boundary for a matrix of
  rates and terms: `payment(P) <= target` **and** `payment(P + 1) > target`. Roughly 31 steps for any realistic
  principal, fully deterministic.
* `solveTargetPayment(...)` walks the canonical candidate terms
  (`SOLVER_TERM_CANDIDATES_MONTHS` = 12, 18, 24, 30, 36, 42, 48, 60, 72, 84), and for each term builds the real
  structure through `structureDeal`, reporting the payment at the available down payment, the largest financeable
  principal that meets the target, the down payment that would meet it, the gap, and whether it fits. The
  recommendation is the **shortest** fitting term (same payment, less interest, less time at risk). When nothing
  fits it says so and names the lowest attainable payment and the down payment that would be required.
* `fitPaymentBudget(...)` builds every (allowed mode x candidate term) through the same `structureDeal`, keeps
  the ones inside the stated payment budget, and orders them with the **same `rankDealStructures`** the Deal Desk
  uses — so the two screens cannot disagree. With no visible cost basis it falls back to payment-then-term
  ordering and says so in the reasons instead of inventing a ranking.

What it explicitly is **not**: not underwriting, not lender approval, not an affordability or credit judgement.
It answers only "given a stated down payment and a stated maximum payment, which structures mathematically
fit?". No income, debt, credit-score, immigration-status, citizenship, nationality, race or ethnicity field
exists anywhere in this product, and none was added — there is nothing to price on.

---

## SECTION 5 — SIMPLE CALCULATOR PRODUCT CONTRACT

The intended operator principle is **BACKEND SOPHISTICATED, CALCULATOR SIMPLE**: the default path takes the
fewest practical inputs, and advanced variables stay progressively disclosed.

| Capability | Status | Evidence |
|---|---|---|
| **1. CALCULATE DEAL** | **IMPLEMENTED** | The Deal Desk's comparison step sends one form to `evaluateDealStructuresAction`, which prices and costs all five payment modes on the server and returns the comparison, the recommendation and the rate-policy verdict. |
| **2. TARGET MONTHLY PAYMENT** | **IMPLEMENTED** (Phase 9D) | `solveTargetPaymentAction` delegates to `solveTargetPayment` in `src/lib/payment-solver.ts`. The operator states vehicle, mode, down payment and a target payment; each candidate term is costed by the canonical engine and the panel shows, per term, the payment, the largest financeable principal, the down payment that would reach the target and whether it fits, with the shortest fitting term recommended. An impossible target returns "NO FEASIBLE TERM AT THIS DOWN PAYMENT" plus the lowest attainable payment and the down payment that would be needed. |
| **3. FIT A PAYMENT BUDGET** | **IMPLEMENTED** (Phase 9D) — **as a mathematical payment-budget fit, nothing more** | `fitPaymentBudgetAction` delegates to `fitPaymentBudget`, which builds every (selected mode × candidate term) through the canonical engine, keeps those whose payment is inside the stated budget, ranks them with the same `rankDealStructures` the Deal Desk uses, and returns the shortest feasible term, payment, amount financed, total customer outlay, dealer capital exposure and — where the role is authorised — vehicle gross. Nothing fits ⇒ `NO FEASIBLE STRUCTURE` with the closest option and its distance. |
| **NOT the same thing: "WHAT CAN THIS CUSTOMER AFFORD?"** (affordability / capacity / credit) | **NOT IMPLEMENTED — deliberately** | This is an underwriting judgement, not arithmetic. The product stores no income, debt or credit data and must not simulate a lender decision. The budget fitter takes the customer's *stated* maximum payment as an input and never infers it. |

**The minimum the normal operator must supply** (Phase 9D requirement): **vehicle + payment mode + down payment
+ term**, then Calculate. Everything else the system already knows is filled from authoritative data — the
selling price falls back to the vehicle's asking price, and the rate, term and down payment fall back to the
dealership's own configured defaults (`DealerSettings.defaultAprBasisPoints`,
`defaultTermMonths`, `defaultDownPaymentCents`). Each of those remains overridable in the form; a fallback is a
convenience, never a silent substitution for an answer the operator gave.

Progressive disclosure as implemented: the Deal Desk has a compact three-path selector and only the selected
path renders; the calculators hide irrelevant fields by mode (cash is excluded from the two solvers because it
has no periodic payment, and the panel says so); rate, lender, first payment date, trade-in, fees, residual,
money factor, purchase option and rate-policy jurisdiction all live inside a collapsed Advanced block; the
vehicle page's eight tabs render only the active section; the price ladder is hidden entirely from roles
without `finance:read`.

---

## SECTION 6 — PHASE 9C: THE DEAL DESK

**Routes:** `/sales/desk` (server component, under SALES — primary navigation is unchanged), reachable
contextually from the vehicle record's Deal tab and from a lead workspace.

**Components added:** `src/app/_components/DealDesk.tsx` (client workbench, 2,734 lines after Phase 9D added the
two calculators). It now opens with a **compact three-path selector** — CALCULATE DEAL (the staged workflow,
default), TARGET MONTHLY PAYMENT and FIT A PAYMENT BUDGET — and only the selected path is mounted, so no path
ever puts two copies of a field name in the live DOM.

| Area | What exists |
|---|---|
| Staged workflow | Seven steps: VEHICLE, BUYER, PRICE, PAYMENT MODE, TERMS, COMPARISON, FINALIZE. Clickable step indicator; earlier steps are one tap away. |
| **Three calculator paths (Phase 9D)** | A compact segmented selector at the top of the workbench: **CALCULATE DEAL** (the staged workflow below, default), **TARGET MONTHLY PAYMENT** and **FIT A PAYMENT BUDGET**. Only the selected path is mounted. Each calculator is a short form (vehicle, mode, down payment, target/max payment) with everything else in a collapsed Advanced block; each renders the server's headline, reasons, warnings and one card per option, and each offers "Use this structure" to carry a chosen mode/term/down payment into the staged workflow (client state only, nothing saved). |
| Price panel | Asking price, target selling price, minimum approved price, expected vehicle gross, expected ROI, negotiation allowance, binding constraint, and the server's reasons/warnings. **Absent entirely** for a role without `finance:read`, with an honest explanation. No value is computed in the browser. |
| Payment-mode selector | Five modes with a hidden field carrying the backend enum value. Contextual fields: CASH (settles at delivery), EXTERNAL FINANCE (+ lender), BHPH (no lender), LEASE / LEASE TO OWN (+ residual, cap cost reduction, money factor, purchase option). |
| Comparison view | One card per mode: cash at closing, vehicle gross (or "Hidden"), capital still exposed, projected finance income, term, payment, amount financed, total customer outlay, lease block, risk labels and the structure's own reasons. Infeasible modes show the server's reason instead of numbers. |
| Recommendation UI | The server's `headline` and `reasons` only, in a prominent panel; the per-card RECOMMENDED chip is driven purely by `mode === recommendedMode`. When the role cannot see the economics the headline says so and no ranking is shown. |
| Rate-policy guard | Selected APR, configured maximum, and a three-state chip: WITHIN CONFIGURED POLICY / OUTSIDE CONFIGURED POLICY / NO POLICY CONFIGURED, with the server's statement and disclaimer displayed verbatim. The text never claims legal compliance. |
| Trade-in | Allowance and lien payoff are entered through the deal-structuring inputs and flow through the server's cash-at-closing arithmetic; the engine flags negative equity. |
| Deal workflow | From `getLiveDealForVehicle`: deal status, finance type, lender, prices, tax, trade-in, dates, the full payment-terms block, the lease block, `titleWorkStatus`, `registrationStatus`, official notes, and the rate-policy snapshot. |
| Documents | **NOT IMPLEMENTED — no backend operation lists, uploads, verifies or signs documents.** An honest empty state is rendered instead. `DealDocument` exists in the schema and `documents:read`/`documents:write` exist in the role matrix, but nothing on the boundary reads or writes a document, and Phase 9C explicitly forbids generating contracts. |
| Role masking | `finance:read` removes the price ladder and every dealer-economics figure (never coerced to $0); `deals:write` removes the finalize control with an explanation. `vehicleGrossCents: null` renders "Hidden". |
| Mobile | Stacked single-column cards, no horizontal mega-tables and no horizontal scroll; figures print their label beside the value; step navigation uses `flex-col-reverse` on phones so Back/Next sit above the thumb; targets ≥ 40px. |

**Deliberate limitation to know about:** the page reads a `customerId` search parameter but `DealDesk` has no
matching prop, so that parameter is currently inert; a walk-in buyer is created from the buyer fields instead.

**Verification basis:** typecheck, repo-wide lint and a real production build (the `/sales/desk` route is
registered). **No click-through against a live database was performed**: the route is guarded by
`requireStaff()`, so a browser session would need seeded credentials. Treat the visual/mobile behaviour as
structured but not yet eyeballed.

---

## SECTION 7 — DATA MODEL / DATABASE

Phases 8.5 and 9A changed **nothing** in the schema. Phase 9B made the only database change of the cycle.

### Enums

| Change | Detail |
|---|---|
| `FinanceType` — one value ADDED | `LEASE_TO_OWN`. No existing value renamed, removed or migrated. |
| `PaymentFrequency` — one enum CREATED | `MONTHLY`, `SEMIMONTHLY`, `BIWEEKLY`, `WEEKLY`. |

### `Deal` — 18 columns added (all money columns nullable; no backfill needed)

`paymentFrequency` (NOT NULL, default `MONTHLY`), `paymentAmountCents`, `finalPaymentCents`,
`numberOfPayments`, `firstPaymentDate`, `salesTaxCents`, `financeChargeCents`, `totalOfPaymentsCents`,
`remainingBalanceCents`, `tradeInPayoffCents`, `capitalizedCostCents`, `capCostReductionCents`,
`residualValueCents`, `moneyFactorAprBasisPoints`, `purchaseOptionCents`, `ratePolicyId`,
`ratePolicyCeilingBasisPoints`, `ratePolicyEvaluatedAt`.

### Constraints added (7 CHECK constraints, all named)

`deals_structured_money_non_negative`, `deals_payment_schedule_sane`,
`deals_payments_arithmetic` (the engine's invariant, enforced by the database),
`deals_total_of_payments_covers_principal`, `deals_lease_structure_sane`,
`deals_rate_policy_snapshot_paired`, `deals_payment_amount_requires_schedule`.

No index was added; no existing column, table, index or constraint was dropped, renamed or rewritten.

### Migrations

| Name | Status |
|---|---|
| `0001_init` … `0005_lock_prisma_migration_history` | **UNCHANGED** — proved by `git status` showing only the new directory as untracked, with no modification to `0001`–`0005`. |
| `0006_deal_structuring_and_finance` | **NEW** (untracked, 110 lines). |

**Validation performed on a disposable PostgreSQL 17 container:** a fresh database was created, roles
`anon`/`authenticated` provisioned, and `prisma migrate deploy` applied all six migrations successfully;
`information_schema` confirmed all 18 columns with correct types and nullability; `pg_constraint` confirmed all
seven new CHECK constraints; `pg_enum` confirmed the enum layouts. `prisma migrate diff --from-url <db>
--to-schema-datamodel prisma/schema.prisma --exit-code` reports **"No difference detected"**, proving the
migration chain and `schema.prisma` agree (this is the check that catches drift such as defect #6 in Section
4.11).

---

## SECTION 8 — FILE CHANGE MANIFEST

Phases are marked **8.5** (audit — produced no file), **9A**, **9B**, **9C**, **9D**.

### DOMAIN / ECONOMICS

| Path | Lines | Phase | Purpose |
|---|---|---|---|
| `src/lib/finance-engine.ts` | 557 | 9B | **NEW.** Amortisation, contract amounts, lease schedule, payment frequencies, drift bound. Integer cents, deterministic rounding. |
| `src/lib/deal-structuring.ts` | 1,063 | 9B | **NEW.** Price ladder, five payment modes, risk flags, scoring, comparison and recommendation. |
| `src/lib/rate-policy.ts` | 239 | 9B | **NEW.** Versioned `FinanceRatePolicy` boundary; ships empty; never claims legal compliance. |
| `src/lib/finance.ts` | 146 | 9B | The public payment estimator now **delegates** its arithmetic to `finance-engine.ts` (behaviour preserved: all 27 existing tests still pass). |
| `src/lib/payment-solver.ts` | 590 | 9D | **NEW.** The inverse solvers: a bisection over the forward engine, the target-payment solver, and the payment-budget fitter. No second amortisation implementation. |
| `src/lib/economics.ts`, `src/lib/sourcing.ts`, `src/lib/money.ts` | — | — | Untouched. The price engine reuses `computeEstimatedGrossProfit` / `computeRoiBasisPoints`. |

### OPERATIONS

| Path | Change | Phase | Purpose |
|---|---|---|---|
| `src/lib/operations/sales.ts` | 572 lines changed | 9B | `completeSaleSchema` gains optional `terms`; `completeVehicleSale` builds and persists the structure, enforces the configured rate policy, and returns flat contract terms; **new** `getLiveDealForVehicle` + `DealTermsView`; `FINANCE_TYPES` gains `LEASE_TO_OWN`. |
| `src/lib/operations/db-errors.ts` | 32 lines added | 9D | **New** `isMissingSchemaError()`: recognises only "the database is behind the code" (Prisma `P2021`/`P2022`, Postgres `42P01`/`42703`), so a production database that has not received `0006` degrades to an honest notice instead of a 500. |

### AUTH / PERMISSIONS

| Path | Change | Phase | Purpose |
|---|---|---|---|
| `src/lib/auth/masking.ts` | 16 lines added | 9A/9B | Added the Phase 9B cost-derived keys (`vehicleGrossCents`, `combinedExpectedEconomicsCents`, the price-ladder gross/ROI tiers, and `score`) to the role mask. Unchanged otherwise: the capability matrix itself was not modified in any phase. |

### SERVER ACTIONS

| Path | Change | Phase | Purpose |
|---|---|---|---|
| `src/app/actions/cars.ts` | 15 lines added | 9A | Forward `titleStatus`, `features`, `acquisitionSource` (no new action). |
| `src/app/actions/sales.ts` | 385 lines changed | 9B | Terms from the form (percent → basis points, with the database's own limits), the rate-policy jurisdiction default, and the new read-only `evaluateDealStructuresAction`. `completeVehicleSaleAction` and `cancelDealAction` unchanged in behaviour. |
| `src/lib/boundary/contracts.ts` | 158 lines added | 9B | `SaleCompletedContract` extended; new `DealStructureContract`, `DealPricingContract`, `DealRatePolicyContract`, `DealComparisonContract`. |

### DATABASE

| Path | Phase | Purpose |
|---|---|---|
| `prisma/schema.prisma` | 9B | One enum value, one enum, 18 `Deal` columns. |
| `prisma/migrations/0006_deal_structuring_and_finance/migration.sql` | 9B | **NEW.** The migration and its seven constraints. |

### UI / COMPONENTS

| Path | Lines | Phase | Purpose |
|---|---|---|---|
| `src/app/_components/BuyAnalyzer.tsx` | 432 | 9A | **NEW.** Analyze / decode / save workbench with the verdict panel. |
| `src/app/_components/DetailTabs.tsx` | 55 | 9A | **NEW.** URL-driven section tabs. |
| `src/app/_components/FieldList.tsx` | 52 | 9A | **NEW.** Label/value list with honest empty handling. |
| `src/app/_components/Timeline.tsx` | 50 | 9A | **NEW.** Activity/status timeline. |
| `src/app/_components/DealDesk.tsx` | 2,734 | 9C + 9D | **NEW.** The staged Deal Desk workbench, plus the three-path selector and the target-payment and payment-budget calculators. |
| `src/app/_components/ActionForm.tsx`, `MoneyMetric.tsx`, `StatusBadge.tsx`, `OperatorNav.tsx`, `PublicNav.tsx`, `PublicFooter.tsx`, `VehiclePhotoGallery.tsx` | — | — | Untouched. |

### ROUTES

| Path | Lines | Phase | Purpose |
|---|---|---|---|
| `src/app/(operator)/buy/page.tsx` | +697 / −349 | 9A | Rebuilt: analyzer, filters, richer candidate cards. |
| `src/app/(operator)/cars/[vehicleId]/page.tsx` | +1,311 / −504 | 9A/9B | Rebuilt as an eight-tab command centre; the Deal tab now shows the **real** persisted terms (its former "deal terms unavailable" note was deleted because it had become false). |
| `src/app/(operator)/cars/page.tsx` | +74 / −32 | 9A | Days in inventory, acquisition source, consistent masking. |
| `src/app/(operator)/leads/page.tsx` | +343 / −157 | 9A | Search/status/open filters, legal quick transitions, richer intake. |
| `src/app/(operator)/leads/[leadId]/page.tsx` | 618 lines (new) | 9A | **NEW.** Lead workspace (+ a contextual link into the Deal Desk). |
| `src/app/(operator)/sales/page.tsx` | +130 / −8 | 9B/9C | Shows the recorded contract terms on completed sales, the Deal Desk entry point, and now reads full deal terms. |
| `src/app/(operator)/sales/desk/page.tsx` | 9C + 9D | **NEW.** Deal Desk route + workflow/documents panels; 9D added the "migration pending" notice around the deal-terms read. |

### TESTS

| Path | Tests | Phase | Purpose |
|---|---|---|---|
| `tests/finance-engine.test.ts` | 66 | 9B | **NEW.** Amortisation matrix, invariants, drift bound, lease-vs-loan, invalid input. |
| `tests/deal-structuring.test.ts` | 68 | 9B | **NEW.** Price ladder, five modes, risk flags, masked viewer, scoring and ranking. |
| `tests/rate-policy.test.ts` | 30 | 9B | **NEW.** Policy selection matrix, ceiling boundary, language guarantees. |
| `tests/db/deal-structuring.integration.test.ts` | 18 | 9B | **NEW.** Real-PostgreSQL persistence and all seven constraints (negative cases included). |
| `tests/payment-solver.test.ts` | 30 | 9D | **NEW.** The inverse-solver suite: boundary proof that the bisection is exact and maximal, monotonicity, degenerate inputs, all four frequencies, both solvers per mode, masked-viewer behaviour, budget monotonicity, and a rebuild of the recommended option through `structureDeal` cent-for-cent. |
| `tests/db-errors.test.ts` | 6 | 9D | **NEW.** Proves the "schema is behind the code" detector matches only that condition and nothing else. |
| `tests/application-boundary.test.ts` | 32 lines changed | 9B | `SaleResult` fixture extended and now anchored with `satisfies SaleResult`, so it cannot silently fall behind the operation again. |
| `tests/db/schema.integration.test.ts` | 20 lines changed | 9B | Updated to the post-0006 facts: 26 enum types / 177 labels, the 33 CHECK constraints, and the six-migration chain. |

### DOCUMENTATION / CONFIGURATION

| Path | Phase | Purpose |
|---|---|---|
| `NEXO_AUTO_PHASE9_HANDOFF.md` | this document | The canonical record of Phases 8.5–9C. |
| `NEXO_AUTO_ARCHITECTURE.md` | — | **Untracked and deliberately untouched.** Do not add, modify or clean it. |
| `AI_STUDIO_UI_CONTRACT.md`, `HANDOFF.md` | — | Untouched. |
| `package.json`, `next.config.ts`, `tsconfig.json`, `vitest*.config.ts`, `.env.example` | — | Untouched in this cycle. |

---

## SECTION 9 — TEST EVIDENCE (final, verified)

| Command | Result |
|---|---|
| `npm test` | **16 files passed, 463 tests passed, 0 skipped** |
| `npm run test:db` | **8 files passed, 165 tests passed** (run against a database built purely by the migration chain, from zero) |
| `npm run typecheck` (`tsc --noEmit`) | clean, no output |
| `npm run lint` (`eslint .`) | clean, no output |
| `npm run build` (`prisma generate && next build`) | **succeeded**, 13 routes: `/`, `/_not-found`, `/admin/denied`, `/admin/login`, `/buy`, `/cars`, `/cars/[vehicleId]`, `/inventory`, `/inventory/[vehicleId]`, `/leads`, `/leads/[leadId]`, `/sales`, `/sales/desk` |
| `git diff --check` | clean (exit 0) |
| `npx prisma validate` | "The schema at prisma/schema.prisma is valid" |
| `npx prisma generate` | Prisma Client v6.19.3 generated into `src/generated/prisma` |
| Migration from zero | all six migrations applied to a fresh PostgreSQL 17 database |
| `prisma migrate diff` (chain → schema) | "No difference detected" |

**How the totals grew:** the project entered this cycle at **263 unit + 147 DB = 410 tests**. Phase 9B added
**164 unit tests** (66 + 68 + 30) and **18 DB tests**, giving **427 + 165 = 592**. Phase 9D added **36 unit
tests** (30 for the inverse solvers, 6 for the "schema is behind the code" detector), giving the final
**463 unit + 165 DB = 628**.

**Defects the Phase 9D tests caught, and fixed:** the bisection's upper bound was not the true maximum at 0% APR
(the forward engine's rounding allows `n/2` more cents of principal), and the lease modes were answered with
LOAN arithmetic, demanding $12,996 down for a 12-month term that already fit with the customer's $2,000. Both
are fixed in the source and both tests now assert the corrected behaviour rather than a skip.

**DB suite note:** the integration suite points at a disposable local PostgreSQL 17 container (port 55432). The
numbers above come from a database (`dealer_phase9d`) created empty and built **solely** by
`prisma migrate deploy`, so the suite was proved against the migration chain itself rather than a
hand-prepared schema. It was run with
`DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/dealer_phase9d?schema=public'`. The pre-existing DB
tests only pass against a **post-0006** database; running them against a pre-9B database is not meaningful.

---

## SECTION 10 — SECURITY / COMPLIANCE BOUNDARIES

Each statement below is backed by implementation, not intention.

| Boundary | Implementation evidence |
|---|---|
| The frontend never owns financial truth | **Verified at the final state.** No client component contains **money** arithmetic. An audit of every `"use client"` file (`ActionForm`, `BuyAnalyzer`, `DealDesk`, `OperatorNav`, `VehiclePhotoGallery`) for `toFixed`, `/ 100`, `* 100`, `/ 12`, `* 12`, `parseFloat`, `parseInt` and `Number(` returns **zero matches in all five files**. `Math.*` appears only in `DealDesk.tsx` (five occurrences: two inside its own explanatory comment, three step-navigation index clamps). Client code renders figures only through `formatCents`, `formatBasisPoints` and `centsToDecimalString`, all leaf formatters in `@/lib/money`; the inverse solvers, amortisation, APR, lease, ROI, gross and finance-charge arithmetic exist **only** on the server. |
| Authorization stays server-side | Every page asserts its capability through `pageOperationContext`, every action through `operationContext`, and every operation re-asserts with `assertCapability`. Hiding a control is presentation, never authorization. |
| Role masking is applied on the server, by field name | `maskVehicleFinancials` nulls cost-derived keys before serialization. Phase 9B added the new keys to that list, and the comparison action masks **each structure individually**, because masking nulls top-level keys only and a nested payload would slip past it. |
| A masked viewer is never given a fabricated figure | The engine treats `landedCostCents: null` as *unknown*, not zero: no gross, no score, no ranking. Asserted by test. |
| No client-side amortisation source of truth | Amortisation exists once, in `src/lib/finance-engine.ts`; `src/lib/finance.ts` delegates to it. |
| No payment processing | There is no ACH, card, autopay, collections or money-movement code anywhere in the repository. No payment credential, processor SDK or webhook exists. |
| No lender approval simulation | The external-finance mode records lender name, rate, term and computed payment. It never records or implies an approval, and the estimator's disclaimer states "Estimate only. Not an offer, approval, or guarantee of credit." |
| No automatic TxDMV / webDEALER submission | `OfficialWorkflowStatus` records **staff-reported progress only**; the schema comment and the UI both say the application never submits anything to TxDMV or webDEALER. |
| A configured rate policy is not a legal-compliance certification | The policy registry ships empty; the status strings are "WITHIN CONFIGURED RATE POLICY" etc.; the disclaimer says the check is not a legal determination; tests assert the text never claims legal compliance. |
| No immigration-status-based pricing | No field, enum, input or code path anywhere in the schema, engine or UI represents immigration or citizenship status. There is nothing to price on. |
| Nothing collects or reports credit information | No credit bureau integration, no credit-score field, no credit application storage. |
| Money is integer cents end to end | Forms parse through `parseMoneyToCents`; operations validate with zod; the database stores INTEGER columns; the engine rounds with a single documented rule. |
| Code and schema deploy separately, and the gap fails safely | Phase 9D pushes code that expects columns created by migration `0006` **before** that migration is applied to production. `isMissingSchemaError()` recognises only "the schema is behind the code" (Prisma `P2021`/`P2022`, Postgres `42P01`/`42703`); the two routes that read stored deal terms catch exactly that condition and render an explicit "migration pending" notice. Every other error is re-thrown untouched, and nothing is written, guessed or auto-migrated. |
| No automatic or destructive migration in build/startup | `package.json` `build` is `prisma generate && next build` — `prisma generate` never touches the database — and `start` is `next start`. There is no `vercel.json` and no `migrate deploy` in any build, startup or request path; migration is only the explicit manual scripts `db:migrate` / `db:deploy`. |
| The calculator collects no protected or irrelevant data | The Phase 9D solvers take a price, a down payment, a payment target and a budget. No income, debt, credit score, immigration status, citizenship, nationality, race or ethnicity field exists in the schema, the engine or the UI, and none was added. Nothing in the product prices on any of them because there is nothing to price on. |

---

## SECTION 11 — INTENTIONALLY NOT IMPLEMENTED

| Capability | Status and reason |
|---|---|
| ACH / card processing / autopay | Not built. Phase 9B forbids it; there is no processor integration and no money-movement code. |
| Collections, late fees, repossession automation | Not built. Nothing services a receivable. `remainingBalanceCents` is a recorded figure that nothing decrements; a servicing ledger is a later phase. |
| Credit bureau reporting | Not built. No bureau integration exists. |
| Loan servicing (statements, payment posting, amortisation *tracking*) | Not built. The engine *schedules* payments; it never records one. |
| Real lender integrations / lender approval APIs | Not built. `lenderName` is a free-text record; the customer's payment is explicitly informational. |
| Production contract generation (PDFs, Reg Z disclosures, lease contracts) | Not built, and lease-to-own is explicitly BLOCKED at the engine level: `contractGeneration: "BLOCKED"` with a reason, because ownership-transfer and disclosure semantics are not defined. |
| Document tracking | Not built anywhere on the boundary: no operation lists, uploads, verifies or signs a document, despite `DealDocument` and the `documents:*` capabilities existing. |
| Production photo delivery | **KNOWN POST-DEPLOYMENT GAP — PHOTO DELIVERY.** Documented at the end of Phase 8 and unchanged: photo bytes are not served in production. |
| Test-drive requests, reservations, saved vehicles, tasks, audit log | Models exist; **no operation reads or writes them**. In particular `AuditLog` is never written by any code path, so `audit:read` has nothing to read. |
| Dealer settings write path | Not built. `settings:write` is in the role matrix, but nothing writes `DealerSettings`, which is why the public site still shows the schema default brand name. |
| User management | Not built. No operation lists, invites or deactivates staff, which is also why a lead's `assignedToId` renders as a raw id. |
| Target-payment and affordability solvers | **Target-payment and payment-budget solvers are IMPLEMENTED (Phase 9D).** Affordability / capacity / credit underwriting remains **NOT IMPLEMENTED — deliberately**: it is a credit judgement, the product stores no income or debt data, and it must not simulate a lender decision. |
| Immigrant/visa-status pricing | Not built, and no data model exists to build it on. |

---

## SECTION 12 — KNOWN GAPS / TECHNICAL DEBT

### P0 — would bite an operator or corrupt understanding

| # | Gap | Where | Status |
|---|---|---|---|
| P0-1 | `features` and `titleStatus` were unassignable end-to-end | Vehicle schema/UI | **FIXED in 9A** |
| P0-2 | LOST lead transition unreachable (no `lostReason` input) | Leads UI | **FIXED in 9A** |
| P0-3 | A cash sale could not be completed at all (zeros violated two CHECK constraints) | `operations/sales.ts` | **FIXED in 9B** |
| P0-4 | Enum label drift `SEMICONTHLY` vs `SEMIMONTHLY` would have failed at runtime | Migration 0006 | **FIXED in 9B** |
| P0-5 | Deal terms were unreadable, so a structured deal would have been write-only | Operations | **FIXED in 9B** (`getLiveDealForVehicle`) |
| P0-6 | Five engine defects (rate guard, NaN tax, discarded scoring, a false documented drift bound, plus the CASH failure) | `finance-engine.ts`, `deal-structuring.ts` | **FIXED in 9B** |
| P0-7 | Public photo delivery is still not working in production | Storage/CDN | **OPEN — deferred by decision**; documented since Phase 8 |

**Deployment order is now a live P0-shaped risk (handled, not open):** the Phase 9 code that reads structured
deal terms is on `main`, while migration `0006` is deliberately **not** applied to production yet. During that
window the two affected routes render a "migration pending" notice rather than a 500 (see Section 10), and no
path auto-migrates. Applying `0006` deliberately is the first item in Section 13.

### P1 — real, but not blocking daily use

| # | Gap |
|---|---|
| P1-1 | No document operation: documents cannot be listed, uploaded, verified or signed (visible as an honest empty state). |
| P1-2 | No dealer-settings write path, so the public site shows the schema default brand ("Dealer Digital") and no operator can change the configured sourcing floors. |
| P1-3 | No staff directory: `assignedToId` is a raw id and a lead cannot be reassigned. |
| P1-4 | A lead's vehicle and a WON lead's deal cannot be resolved to readable records, so a workspace shows raw ids. |
| P1-5 | `LeadWithCustomer` carries only the contact core, so address/city/state/postal/notes cannot be displayed or prefilled. |
| P1-6 | "Which follow-ups are late" is not answerable: `leadListFilterSchema` has no due/overdue filter, so the UI shows the date and refuses to judge it. |
| P1-7 | `listInventory` returns no photo, so the CARS list has no thumbnail. |
| P1-8 | Expense edit/delete and vehicle archive/delete do not exist (create-only). |
| P1-9 | The Deal Desk reads a `customerId` search parameter that no component consumes (inert). |
| P1-10 | Lease tax treatment is deliberately **not** computed (jurisdiction-specific); the engine raises `LEASE_TAX_TREATMENT_NOT_COMPUTED` rather than inventing a rule. |
| P1-11 | The Deal Desk — including the Phase 9D target-payment and payment-budget paths — has not been visually verified in a browser (no session/credentials available in the build environment). Verified by typecheck, lint and a real production build only. |
| P1-12 | Nothing decrements `remainingBalanceCents`; it is a contract-time figure until a servicing phase exists. |

### P2 — cosmetic or convenience

| # | Gap |
|---|---|
| P2-1 | `HANDOFF.md` is stale (says "not a git repository", "no UI layer") and contains mojibake in its headings. |
| P2-2 | The DB suite requires a manually provisioned PostgreSQL with the `anon`/`authenticated` roles created before migrating; there is no one-command way to bring it up. |
| P2-3 | `prisma generate` can fail with an EPERM file-lock on Windows if a test run is holding the query-engine DLL; serialize build and test runs. |
| P2-4 | `tests/db/schema.integration.test.ts` hard-codes catalog counts (enum types, labels, constraint names), so every future migration must update it. |

### DEFERRED BY DESIGN (not debt)

| Item | Why |
|---|---|
| Rate-policy evidence retention beyond the three snapshot columns | Storing the full policy document is an archival concern for a compliance phase, not for structuring. |
| A policy-editing UI | The registry is code-level configuration; a DB-backed policy table is a deliberate later migration. |
| `getSourcingCandidate` with no dedicated screen | `listSourcingCandidates` already returns the complete candidate row; a detail page would add no information. |
| No `landedCost`-aware ranking for masked roles | Ranking on a partially visible cost basis would be a fabricated recommendation; the engine declines to rank instead. |
| Migration 0006 not applied to production | Explicitly out of scope: production Supabase must not be touched. |

---

## SECTION 13 — NEXT RECOMMENDED WORK

The engine is now deeper than the operation has proven. The smallest useful next sequence is **validation and
exposure, not more architecture**:

1. **Run the business once, for real.** Create a dealer account, put one real car through BUY → CARS → LEADS →
   SALES with the Deal Desk, and write down every place the flow fought back. Do this before building anything
   else. It is the only way to find out whether a 2–5 car micro-dealer needs any of the remaining gaps.
2. **Apply migration 0006 to production and verify it, deliberately** (backup, `migrate deploy`, check the enum
   and the constraints, confirm no existing migration changed). This is now the single blocking step for Phase 9:
   the code is on `main`, the schema is not, and until it is applied **no structured deal can be persisted in
   production and the recorded deal terms cannot be read**. Remember that a green Vercel deployment does **not**
   mean the production database is ready.
3. **Fix P0-7 (photo delivery)** if the public site is going to be shown to anyone: it is the only P0 still open.
4. **Then pick at most one P1 from evidence, not intuition.** The two most likely to be felt first are P1-2
   (settings write path — the brand name and the sourcing floors are both invisible/unchangeable today) and P1-1
   (documents), because a sale that cannot attach a title or a buyer's order is incomplete for a real dealer.
5. **Do not build** lender integrations, servicing, collections, credit reporting or an affordability engine
   until a real deal has been blocked by their absence.

---

## SECTION 14 — FINAL SYSTEM MAP

Adjusted to what actually exists. `[GAP]` marks a step the software cannot yet complete.

```
SOURCE CAR (auction / marketplace / trade-in / walk-in)
   |
   v
BUY — capture + evaluate ................................ /buy
   |   decode VIN, score with the canonical engine, see the verdict and the reasons
   v
BUY / WATCH / PASS ..................................... decision recorded on the candidate
   |
   v
ACQUIRE ................................................ candidate -> owned vehicle
   |   real VIN/year/make/model/mileage required; acquisition costs, title status
   v
INSPECT / RECON ........................................ /cars/[id] -> Recon tab
   |   recon items, estimates, actual cost on completion
   v
INVENTORY .............................................. /cars  (days in inventory, cost, exposure)
   |
   v
PRICE .................................................. /cars/[id] -> Economics tab
   |   asking / target / minimum approved, landed cost, gross, ROI
   |   [GAP] the price LADDER is recommended in the Deal Desk, not persisted on the vehicle
   v
LIST ................................................... publish -> public catalog
   |   [GAP] production photo delivery
   v
LEAD ................................................... /leads  and  /leads/[id]
   |   intake, contact editing, timeline, legal lifecycle moves, lostReason
   |
   v
TEST DRIVE / NEGOTIATE .................................
   |   [GAP] TestDriveRequest has no operation at all
   v
DEAL DESK .............................................. /sales/desk
   |   THREE PATHS, selected by a compact mode selector (only one renders):
   |
   |   [1] CALCULATE DEAL ......... 1 VEHICLE  2 BUYER  3 PRICE  4 PAYMENT MODE
   |   |                            5 TERMS  6 COMPARISON  7 FINALIZE
   |   |                            the server prices and costs every mode; the
   |   |                            recommendation comes from the engine
   |   |
   |   [2] TARGET MONTHLY PAYMENT . "around $450 a month"
   |   |                            vehicle + mode + down + target (+ advanced)
   |   |                            -> per term: payment, largest financeable
   |   |                               principal, down payment that would hit the
   |   |                               target, fits/does-not-fit, shortest term
   |   |                               recommended; or NO FEASIBLE TERM with the
   |   |                               lowest attainable payment
   |   |
   |   [3] FIT A PAYMENT BUDGET ... vehicle + down + max payment + allowed modes
   |                                -> every (mode x term) built by the canonical
   |                                   engine, those inside the budget ranked by
   |                                   the same scorer the Desk uses; or
   |                                   NO FEASIBLE STRUCTURE with the closest one
   v
CASH / BANK / NEXO FINANCE (BHPH) / LEASE / LEASE-TO-OWN
   |   vehicle gross and finance income are separate metrics; capital exposure is explicit
   |   [GAP] lease-to-own calculates but its contract generation is BLOCKED by design
   v
DOCUMENTS ..............................................
   |   [GAP] no document operation exists: nothing can be listed, uploaded, verified or signed
   v
SALE ................................................... completeVehicleSale
   |   one transaction: deal contracted, structure persisted, vehicle SOLD, status event written
   v
TITLE / REGISTRATION ................................... staff-reported status only
   |   the application never submits to TxDMV / webDEALER
   v
DELIVERY ............................................... delivery date recorded
   |
   v
ACTUAL PROFIT .......................................... final sale price - landed cost
       real cost from recon + expenses; ROI in basis points
       [GAP] nothing tracks the money coming back in on a dealer-held note
```

**End of handoff.**

---

**NEXO AUTO PHASE 9 CANONICAL HANDOFF READY FOR REVIEW**
