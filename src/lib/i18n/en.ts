/**
 * Nexo Auto — public (customer-facing) English copy.
 *
 * This file is the SINGLE place English marketing and interface text lives.
 * Pages and components read from it through `t()` / `tc()`; none of them hold
 * their own strings. That is what makes the Spanish edition a translation of
 * one source rather than a hunt through JSX.
 *
 * Scope: customer-facing surfaces only — landing page, header, footer,
 * inventory, vehicle cards and vehicle detail. The operator/admin application is
 * intentionally not translated.
 *
 * Placeholders use `{braces}` and are declared in `PARAM_KEYS` (see
 * `src/lib/i18n/index.ts`), so a parameterised string cannot be rendered
 * without its value.
 *
 * Vehicle DATA is never translated: VIN, stock number, make, model, trim,
 * mileage, prices, colours and descriptions pass through unchanged. Only the
 * labels around them are localized.
 */
export const en = {
  // ---- Shared / metadata -------------------------------------------------
  "meta.siteName": "Nexo Auto",
  "meta.home.title": "Nexo Auto — Simple car buying",
  "meta.home.description":
    "Browse a focused selection of used vehicles with clear pricing, straightforward financing options, and a digital-first process you can run from your phone.",
  "meta.inventory.title": "Inventory",
  "meta.inventory.description":
    "Browse every vehicle currently listed at Nexo Auto with asking price, mileage, equipment and photos.",
  "meta.vehicle.notFound": "Vehicle not found",
  "meta.vehicle.description":
    "{vehicle} with {mileage} miles, listed at {price} by Nexo Auto.",
  "meta.tagline": "Simple car buying",

  // ---- Brand family ------------------------------------------------------
  "brand.familyNote": "Part of the {family} family — the same team behind Nexo Rental.",
  "brand.familyName": "Nexo",

  // ---- Language selector -------------------------------------------------
  "language.label": "Language",
  "language.switchTo": "Switch to {language}",
  "language.english": "English",
  "language.spanish": "Spanish",

  // ---- Header / navigation ----------------------------------------------
  "nav.primary": "Primary",
  "nav.home": "{name} — home",
  "nav.inventory": "Inventory",
  "nav.howItWorks": "How it works",
  "nav.buyingOptions": "Buying options",
  "nav.browseCars": "Browse cars",
  "nav.browseCarsShort": "Browse",
  "nav.callDealer": "Call {name} at {phone}",
  "nav.operatorSignIn": "Operator sign in",

  // ---- Accessibility -----------------------------------------------------
  "a11y.srHeadline": "{name} — used vehicles, clear pricing, simple car buying",

  // ---- Homepage: hero ----------------------------------------------------
  "home.hero.badge": "Simple car buying",
  "home.hero.headlineFallback": "Fewer cars. Carefully selected.",
  "home.hero.subtextFallback":
    "Nexo Auto is a small, modern dealership built around one idea: buying a used car should be simple, clear, and free of pressure. Browse the cars, see real prices, and structure a deal that fits your budget.",
  "home.hero.primaryCta": "Browse inventory",
  "home.hero.secondaryCta": "See how it works",
  "home.hero.assuranceInventory": "Real, current inventory",
  "home.hero.assurancePricing": "Clear pricing",
  "home.hero.assuranceFinancing": "Financing guidance available",
  "home.hero.preferTalk": "Prefer to talk it through?",
  "home.hero.call": "Call {phone}",
  "home.hero.email": "Email us",

  // ---- Homepage: benefits -------------------------------------------------
  "home.benefits.eyebrow": "Why Nexo Auto",
  "home.benefits.title": "Buying a car, without the usual friction",
  "home.benefits.subtitle":
    "No pressure floor plan, no wall of add-ons, no mystery about the price. Here is what that looks like in practice.",
  "home.benefits.pricing.title": "Clear pricing up front",
  "home.benefits.pricing.body":
    "Every listed vehicle shows its asking price on the card. No “call for price”, no bait listing, no surprise add-ons before you have decided anything.",
  "home.benefits.market.title": "Smart pricing, less guesswork",
  "home.benefits.market.body":
    "We price against real market evidence rather than a hunch, so the number you see reflects what comparable vehicles are actually selling for.",
  "home.benefits.options.title": "Options that fit a budget",
  "home.benefits.options.body":
    "Cash, traditional financing, or a deal built around what you can comfortably put down. You see the structure before you commit to it.",
  "home.benefits.mobile.title": "Built for your phone",
  "home.benefits.mobile.body":
    "Search, compare and request details from the phone in your hand. No showroom trip required just to find out whether a car is worth seeing.",
  "home.benefits.selection.title": "Fewer cars, chosen carefully",
  "home.benefits.selection.body":
    "We keep the inventory small on purpose. Each vehicle gets real attention before it is listed, and nothing sits there as filler.",
  "home.benefits.cta.title": "Ready when you are",
  "home.benefits.cta.body":
    "Start with the cars. If something looks right, we will take it from there — no forms to unlock pricing.",
  "home.benefits.cta.action": "See available cars",

  // ---- Homepage: inventory preview ---------------------------------------
  "home.inventory.titleWithStock": "Available now",
  "home.inventory.titleEmpty": "Current inventory",
  "home.inventory.bodyWithStock":
    "The vehicles currently listed, with the price on the card. Tap any one for photos, specifications and the full breakdown.",
  "home.inventory.bodyEmpty":
    "We list vehicles as they are ready — not before. There is nothing published at this moment, and we would rather show you an empty page than a car you cannot buy.",
  "home.inventory.viewAll": "View all inventory",
  "home.inventory.empty.title": "New vehicles are being selected",
  "home.inventory.empty.body":
    "Inventory changes as vehicles are sourced and prepared. Tell us what you are looking for and we will let you know when something fits — or check back shortly.",
  "home.inventory.empty.call": "Call {phone}",
  "home.inventory.empty.email": "Tell us what you need",
  "home.inventory.empty.recheck": "Check inventory again",
  "home.inventory.empty.mailSubject": "Vehicle request — {name}",

  // ---- Homepage: how it works --------------------------------------------
  "home.steps.eyebrow": "How it works",
  "home.steps.title": "Four steps, no surprises",
  "home.steps.subtitle":
    "The same process whether you are paying cash or financing. You will always know where you are and what happens next.",
  "home.steps.1.title": "Browse the cars",
  "home.steps.1.body":
    "Start with what is actually available. Photos, mileage, equipment and price on one clean page.",
  "home.steps.2.title": "Review your options",
  "home.steps.2.body":
    "Compare vehicles side by side and see how each one lines up with what you want to spend.",
  "home.steps.3.title": "Structure the deal",
  "home.steps.3.body":
    "Tell us your budget and down payment. We lay out the paths that fit — and the ones that do not.",
  "home.steps.4.title": "Move forward",
  "home.steps.4.body": "Once the numbers and the car are right, we handle the paperwork and get you on the road.",
  "home.steps.cta": "Start your search",
  "home.steps.note": "No account, no forms, no price hidden behind a phone call.",

  // ---- Homepage: buying options ------------------------------------------
  "home.options.eyebrow": "Buying options",
  "home.options.title": "Pay the way that suits you",
  "home.options.subtitle":
    "There is more than one way to buy a car here, and choosing one does not lock you in. We will walk through the options with your numbers in front of us.",
  "home.options.cash.title": "Pay cash",
  "home.options.cash.body": "The simplest path. Agree on the price, complete the paperwork, take the keys.",
  "home.options.cash.point1": "Price agreed in writing",
  "home.options.cash.point2": "No financing paperwork",
  "home.options.cash.point3": "Fastest handover",
  "home.options.finance.title": "Traditional financing",
  "home.options.finance.body":
    "We help you work through a lender application and collect what is needed, so you are not assembling it alone.",
  "home.options.finance.point1": "Guidance through the application",
  "home.options.finance.point2": "Subject to lender review",
  "home.options.finance.point3": "Terms set by the lender",
  "home.options.guided.title": "Guided deal structuring",
  "home.options.guided.body":
    "Bring a budget and a target payment. We map out the terms that get close, and show plainly where the choice sits.",
  "home.options.guided.point1": "Payment and term scenarios",
  "home.options.guided.point2": "Estimates, not approvals",
  "home.options.guided.point3": "Adjust and compare before deciding",
  "home.options.flexible.title": "Flexible ownership paths",
  "home.options.flexible.body":
    "Depending on the vehicle and your situation, lease-style and longer-term arrangements may be available. Ask and we will tell you honestly what applies.",
  "home.options.flexible.point1": "Availability depends on the vehicle",
  "home.options.flexible.point2": "Explained before you commit",
  "home.options.flexible.point3": "No obligation to proceed",
  "home.options.disclaimerLabel": "About financing:",
  "home.options.disclaimer":
    "any payment, term or rate shown anywhere on this site is an estimate for planning purposes only. It is not a loan offer, not a credit decision, and not a guarantee of approval. Final terms come from the lender and depend on your application.",

  // ---- Homepage: trust ----------------------------------------------------
  "home.trust.eyebrow": "Why Nexo Auto",
  "home.trust.title": "Trust built on how we work, not on what we claim",
  "home.trust.subtitle":
    "We are a small operation, so we compete on clarity rather than volume. These are the things we can stand behind today.",
  "home.trust.process.title": "A process you can follow",
  "home.trust.process.body":
    "Every step is explained before it happens. You always know what comes next and what it costs.",
  "home.trust.car.title": "The car in front of you",
  "home.trust.car.body":
    "Listings reflect vehicles we actually have, with the details we actually know — nothing padded out.",
  "home.trust.people.title": "A person, not a portal",
  "home.trust.people.body":
    "Digital-first does not mean unreachable. Call, text or email and you get a straightforward answer.",
  "home.trust.pressure.title": "Decide without pressure",
  "home.trust.pressure.body":
    "Numbers and options are yours to review. There is no countdown clock and no obligation to buy.",
  "home.trust.aboutTitle": "About {name}",

  // ---- Homepage: final CTA ------------------------------------------------
  "home.final.eyebrow": "Next step",
  "home.final.titleWithStock": "Find the car, then take your time",
  "home.final.titleEmpty": "Tell us what you are looking for",
  "home.final.bodyWithStock":
    "Look through what is available, and reach out with any question — the price, the history, the financing, or whether the car suits your week.",
  "home.final.bodyEmpty":
    "Inventory is thin right now, and we would rather match you to the right vehicle than push the wrong one. Send us your budget and what you need the car to do.",
  "home.final.browse": "Browse inventory",
  "home.final.call": "Call {phone}",
  "home.final.email": "Email {name}",

  // ---- Vehicle card -------------------------------------------------------
  "card.photosSoon": "Photos coming soon",
  "card.askingPrice": "Asking price",
  "card.explore": "Explore",
  "card.viewAction": "View {vehicle}, stock number {stock}, {price}",
  "card.photoAlt": "Photo of {vehicle}",

  // ---- Inventory index ----------------------------------------------------
  "inventory.breadcrumbHome": "Home",
  "inventory.breadcrumbCurrent": "Inventory",
  "inventory.title": "Vehicle inventory",
  "inventory.intro":
    "Everything currently listed by {name}, with the asking price shown up front. Open any vehicle for photos, specifications and options.",
  "inventory.searchLabel": "Search inventory by make, model, VIN or stock number",
  "inventory.searchPlaceholder": "Make, model, VIN…",
  "inventory.searchAction": "Search",
  "inventory.resultsMatching": "Showing results for {query}",
  "inventory.resultsCountOne": "Showing {count} listed vehicle",
  "inventory.resultsCountOther": "Showing {count} listed vehicles",
  "inventory.empty.searchTitle": "No vehicles match {query}",
  "inventory.empty.title": "No vehicles listed right now",
  "inventory.empty.searchBody":
    "Try a different make, model or stock number — or clear the search to see everything currently listed.",
  "inventory.empty.body":
    "New vehicles appear here as they are prepared for sale. Nothing is published until it is genuinely available.",
  "inventory.empty.clearSearch": "Clear search",
  "inventory.empty.home": "Back to home",
  "inventory.empty.askAboutUpcoming": "Ask about upcoming cars",
  "inventory.paginationLabel": "Inventory pages",
  "inventory.previous": "Previous",
  "inventory.next": "Next",
  "inventory.page": "Page {page}",

  // ---- Vehicle detail -----------------------------------------------------
  "vehicle.notFoundTitle": "Vehicle not found",
  "vehicle.statusAvailable": "Available",
  "vehicle.statusReserved": "Reserved",
  "vehicle.askingPrice": "Asking price",
  "vehicle.priceNote": "Plus tax, title and registration where applicable.",
  "vehicle.about": "About this vehicle",
  "vehicle.features": "Features & equipment",
  "vehicle.interestedTitle": "Interested in this vehicle?",
  "vehicle.interestedBody":
    "Ask us to confirm availability, arrange a look, or walk through the numbers with you. No obligation either way.",
  "vehicle.call": "Call {phone}",
  "vehicle.emailAction": "Email about this vehicle",
  "vehicle.noContact": "Dealer contact details have not been configured yet.",
  "vehicle.optionsLink": "See cash, financing and flexible options",
  "vehicle.financeNote":
    "Payment and term figures are estimates only — not an offer, not a credit decision and not a guarantee of approval.",
  "vehicle.specs": "Specifications",
  "vehicle.backToInventory": "Back to all inventory at {name}",
  "vehicle.mailSubject": "Inquiry about {vehicle} (Stock #{stock})",
  "vehicle.srSummary": "{vehicle}, asking price {price}",

  // ---- Specifications labels ---------------------------------------------
  "spec.mileage": "Mileage",
  "spec.exteriorColor": "Exterior colour",
  "spec.interiorColor": "Interior colour",
  "spec.transmission": "Transmission",
  "spec.drivetrain": "Drivetrain",
  "spec.engine": "Engine",
  "spec.fuelType": "Fuel type",
  "spec.bodyType": "Body type",
  "spec.titleStatus": "Title status",
  "spec.location": "Location",
  "spec.notRecorded": "Not recorded",
  "spec.miles": "{count} miles",
  "spec.stockNumber": "Stock #{stock}",
  "spec.vin": "VIN {vin}",

  // ---- Gallery ------------------------------------------------------------
  "gallery.placeholder": "Photo placeholder",
  "gallery.previous": "Previous photo",
  "gallery.next": "Next photo",
  "gallery.counter": "{current} / {total}",
  "gallery.thumbnail": "Photo {index} of {total}",

  // ---- Status badges ------------------------------------------------------
  "status.available": "AVAILABLE",
  "status.reserved": "RESERVED",
  "status.demo": "DEMO",

  // ---- Footer -------------------------------------------------------------
  "footer.explore": "Explore",
  "footer.browseInventory": "Browse inventory",
  "footer.howItWorks": "How it works",
  "footer.buyingOptions": "Buying options",
  "footer.whyNexo": "Why Nexo Auto",
  "footer.talkToUs": "Talk to us",
  "footer.noContact": "Contact details appear here once they are configured in dealer settings.",
  "footer.financeNote": "Financing figures shown on listings are estimates, never approvals.",
  "footer.rights": "© {year} {name}. All rights reserved.",
  "footer.taglineFallback":
    "A focused selection of used vehicles with clear pricing and a straightforward path from browsing to keys.",

  // ---- Customer-visible failure states -----------------------------------
  "error.genericTitle": "Something went wrong",
  "error.genericBody": "Please try again. If it keeps happening, call or email us and we will help directly.",
} as const;
