# AI Studio — UI integration contract

The backend is complete and validated. This document is what a UI implementation
needs in order to build the interface **without** re-deriving business rules,
without touching Prisma, and without inventing authorization.

Read this before replacing or extending any page under `src/app`.

---

## 1. The supported boundary (do not bypass these files)

| Concern | File | Rule |
|---|---|---|
| Server actions (all mutations) | `src/app/actions/{auth,buy,cars,leads,sales}.ts` | The ONLY way the browser changes state |
| Result & error types | `src/lib/boundary/contracts.ts` | Primitives only; safe to import in a client component |
| Actor + capability context | `src/lib/operations/runtime.ts` | `operationContext()` for actions, `pageOperationContext()` for pages |
| Reads for operator pages | `src/lib/operations/*` | Called directly from server components |
| Public catalog | `src/lib/public-catalog.ts` | The ONLY anonymous read path |
| Errors / codes | `src/lib/action-result.ts` | `ActionResult`, `runOperation`, error codes |

**Never** in UI code: instantiate `PrismaClient`, query tables or views directly,
compute money or profit, decide authorization, or accept an actor/role/capability
from the browser.

---

## 2. Authentication

- Sign in: `POST` to the server action in `src/app/actions/auth.ts` (`loginAction`),
  rendered at `/admin/login`. Passwords are verified with bcrypt server-side; the
  session is an httpOnly cookie holding a random token whose SHA-256 hash is the
  only thing stored in the database.
- Sign out: `logoutAction` (deletes the session row, clears the cookie).
- Existing guards: `requireStaff()` / `requireCapability()` for pages (they
  redirect), `authorize()` for actions (it throws).
- The operator layout (`src/app/(operator)/layout.tsx`) is the route gate. A UI
  must not replace it with a client-side check.
- Accounts are provisioned, not self-service. Locally: `npm run db:seed` with
  `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`. There is no signup, reset, SSO or MFA.

---

## 3. Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | public | Storefront home (dealer identity + featured inventory) |
| `/inventory`, `/inventory/[vehicleId]` | public | Catalog list and detail |
| `/admin/login` | public | Operator sign-in |
| `/admin/denied` | staff | Shown when a capability is missing |
| `/buy`, `/cars`, `/cars/[vehicleId]`, `/leads`, `/sales` | staff | Operator surfaces |

All DB-backed pages set `export const dynamic = "force-dynamic"` so `next build`
never needs a database. Keep that on any new data-reading page.

---

## 4. Calling the backend

### Reads (server components)

```tsx
const ctx = await pageOperationContext("inventory:read"); // redirects if not allowed
const { items, total } = await listInventory(ctx, { limit: 50 });
```

### Mutations (server actions)

```tsx
const result = await publishVehicleAction(formData); // ActionResult<VehicleMutationContract>
if (!result.ok) show(result.error, result.code);
```

Rules:
- Actions take `FormData` and return `ActionResult<T>`. They never throw at the UI.
- **Money is typed by a human and converted once**, server-side, by the boundary
  (`parseMoneyToCents`). Send `"18500"` or `"$18,500"` — never cents, never floats.
- Every action resolves the actor from the session. Extra form fields such as
  `actorId`, `role` or `capabilities` are ignored.
- `ActionForm` (`src/app/_components/ActionForm.tsx`) is temporary scaffolding
  showing the expected pending/error behaviour. Replace it freely; keep calling
  the same actions.

---

## 5. Error contract

`ActionResult` is either `{ ok: true, data }` or:

```ts
{ ok: false; error: string; code: ActionErrorCode; fieldErrors?: Record<string, string[]> }
```

| Code | Meaning | Suggested UI |
|---|---|---|
| `VALIDATION_ERROR` | Bad or missing input; see `fieldErrors` | Inline field errors |
| `UNAUTHORIZED` | No valid session | Send to `/admin/login` |
| `FORBIDDEN` | Signed in, capability missing | Explain, link to `/admin/denied` |
| `NOT_FOUND` | Record gone | Empty state |
| `CONFLICT` | Clashes with current state (duplicate VIN, existing live deal) | Explain and offer the next step |
| `INVALID_STATE` | Illegal lifecycle move | Show the message; it names both states |
| `INTERNAL_ERROR` | Unexpected; already logged server-side | Generic "try again" |

Messages are written for operators and are safe to display. Never render a raw
exception: none is ever returned.

---

## 6. What each role receives

Capabilities live in `src/lib/auth/roles.ts` (unchanged). Reads through the
operation layer are **already masked** — no client-side hiding is required or
sufficient.

| Data | OWNER / MANAGER | SALES | RECON | VIEWER |
|---|---|---|---|---|
| Asking, target and minimum price | yes | asking + target | asking + target | asking + target |
| Landed cost, acquisition cost, margin, ROI | yes | **null** | **null** | **null** |
| Expense rows | yes | omitted | yes | omitted |
| Recon items | yes | omitted | yes | omitted |
| Tracker device, coordinates, geofence | yes | **null** | **null** | **null** |
| Mutations | all | leads, deals | inventory, recon, expenses | none |

Sourcing economics (`/buy`) are visible to any role holding `sourcing:read`
(OWNER, MANAGER, SALES) — that is the existing capability model, not an oversight.

A `null` cost field means "withheld" **or** "not recorded". Do not infer zero.

---

## 7. Public catalog

`listPublicInventory()` and `getPublicVehicle()` read the approved SQL views
(`public_vehicle_listings`, `public_vehicle_photos`, `public_vehicle_availability`)
created in migration 0003. They never read base tables, so there is no field list
to maintain and no internal column to accidentally expose.

- A vehicle appears only when `listingStatus = ACTIVE`, status is `LISTED` or
  `RESERVED`, and the asking price is > 0.
- Sold, unlisted and unknown ids all produce `null` → render `notFound()`.
- Reservations surface only as `availability: "RESERVED"`; never who reserved.
- `getPublicDealerInfo()` is read-only on purpose: a public page view must not
  create the settings row.

---

## 8. Must NOT be reimplemented in the UI

These exist once, server-side, and are tested:

- landed cost, estimated/actual gross profit, ROI, days in inventory
  (`src/lib/economics.ts`)
- the sourcing verdict, ceilings and BUY/WATCH/PASS (`src/lib/sourcing.ts`)
- amortised financing estimates (`src/lib/finance.ts`)
- vehicle lifecycle and lead lifecycle rules (`vehicle-status.ts`, `lead-status.ts`)
- role/capability decisions and field masking (`auth/roles.ts`, `auth/masking.ts`)
- the display of money as integer cents (`src/lib/money.ts` — use `formatCents`)
- upload validation (magic-byte sniffing, size ceilings) in `src/lib/storage.ts`

If a screen needs a new derived number, add it to the operation layer with a
test — not to a component.

---

## 9. Loading and error behaviour

- Mutations: disable the control and show a busy label while the action is in
  flight (see `ActionForm`), then refresh the route so server data updates.
- `UNAUTHORIZED`: navigate to `/admin/login`.
- `FORBIDDEN`: keep the user where they are and explain the missing capability.
- `VALIDATION_ERROR`: attach `fieldErrors[field]` to the matching input.
- Public catalog: an empty result is a valid state ("no published vehicles"), not
  an error.

---

## 10. Known gaps (deliberate, not bugs)

1. **Photo bytes are not served over HTTP.** Upload/delete/set-primary work
   through the boundary, and the public views expose photo URLs, but there is no
   route that streams `var/uploads`. Public image delivery needs a signed-URL or
   object-storage strategy — do not make `/api/files` world-readable to shortcut it.
2. **No HTTP/JSON API.** Reads happen in server components, mutations in server
   actions. One boundary per use case by design; add a route handler only for a
   genuinely public, URL-shaped need.
3. **Presentation is placeholder.** Plain markup and minimal CSS exist so the app
   runs; the visual system is yours to design.
4. **Not built and out of scope:** password reset, SSO/MFA, email/SMS, financing
   and lender workflows, reservations, delivery, documents, webDEALER, auction or
   history/valuation providers, Traccar activation, analytics.
