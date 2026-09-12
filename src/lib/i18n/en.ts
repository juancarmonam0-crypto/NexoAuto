/**
 * Nexo Auto — public (customer-facing) English copy.
 *
 * This file is the SINGLE place English marketing and interface text lives.
 * Pages and components read from it through `t()` / `tc()`; none of them hold
 * their own strings. That is what makes the Spanish edition a translation of one
 * source rather than a hunt through JSX.
 *
 * Scope: customer-facing surfaces only — landing page, header, footer,
 * inventory, vehicle cards, vehicle detail and the theme control. The
 * operator/admin application is intentionally not translated.
 *
 * Placeholders use `{braces}` and are declared in `PARAM_KEYS` (see
 * `src/lib/i18n/catalog.ts`), so a parameterised string cannot be rendered
 * without its value. `{{double braces}}` mark a run of words that the page
 * emphasises in Nexo orange — the mockup's headline treatment — and are styled
 * at render time, never stored as markup.
 *
 * Vehicle DATA is never translated: VIN, stock number, make, model, trim,
 * mileage, prices, colours and descriptions pass through unchanged. Only the
 * labels around them are localized.
 */
export const en = {
  // ---- Shared / metadata -------------------------------------------------
  "meta.siteName": "Nexo Auto",
  "meta.home.title": "Nexo Auto — Better cars. A simpler way.",
  "meta.home.description":
    "Carefully selected used cars with clear pricing and flexible ways to buy. See what is available near you and understand your options before you decide.",
  "meta.inventory.title": "Inventory",
  "meta.inventory.description":
    "Every vehicle currently listed at Nexo Auto, with asking price, mileage, equipment and photos.",
  "meta.vehicle.notFound": "Vehicle not found",
  "meta.vehicle.description": "{vehicle} with {mileage} miles, listed at {price} by Nexo Auto.",
  "meta.tagline": "Simple car buying",

  // ---- Brand family ------------------------------------------------------
  "brand.familyNote": "Part of the {family} family — the same team behind Nexo Rental.",
  "brand.familyName": "Nexo",

  // ---- Language selector -------------------------------------------------
  "language.label": "Language",
  "language.switchTo": "Switch to {language}",
  "language.english": "English",
  "language.spanish": "Spanish",

  // ---- Theme control -----------------------------------------------------
  "theme.label": "Theme",
  "theme.switchTo": "Switch to {theme}",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "theme.legend": "Appearance",

  // ---- Header / navigation ----------------------------------------------
  "nav.primary": "Primary",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",
  "nav.menuTitle": "Menu",
  "nav.home": "{name} — home",
  "nav.inventory": "Inventory",
  "nav.howItWorks": "How it works",
  "nav.financing": "Financing",
  "nav.about": "About",
  "nav.contact": "Contact",
  "nav.browseCars": "Browse cars",
  "nav.browseCarsShort": "Browse",
  "nav.callDealer": "Call {name} at {phone}",
  "nav.callUs": "Call us",
  "nav.emailUs": "Email us",
  "nav.operatorSignIn": "Operator sign in",

  // ---- Accessibility -----------------------------------------------------
  "a11y.srHeadline": "{name} — used cars, clear pricing, simple car buying",
  "a11y.heroImage": "A white SUV photographed in front of a city skyline at sunset",

  // ---- Homepage: hero ----------------------------------------------------
  "home.hero.eyebrow": "Simple car buying",
  "home.hero.headline": "Better cars.\nA {{simpler way.}}",
  "home.hero.subtext":
    "Carefully selected used cars, clear pricing, and flexible ways to buy. See what is available and understand your options before you decide.",
  "home.hero.primaryCta": "Browse cars",
  "home.hero.secondaryCta": "How it works",
  "home.hero.assurancePricing": "Transparent pricing",
  "home.hero.assurancePricingBody": "No hidden fees",
  "home.hero.assuranceSelection": "Carefully selected inventory",
  "home.hero.assuranceSelectionBody": "Quality you can trust",
  "home.hero.assuranceFinancing": "Financing guidance available",
  "home.hero.assuranceFinancingBody": "Options for your budget",

  // ---- Homepage: inventory preview ---------------------------------------
  "home.inventory.eyebrow": "Inventory",
  "home.inventory.title": "Find the right car for your next chapter.",
  "home.inventory.subtitle":
    "Every vehicle below is actually available right now, with the asking price shown up front.",
  "home.inventory.viewAll": "View all inventory",
  "home.inventory.empty.title": "New vehicles are being selected",
  "home.inventory.empty.body":
    "We list vehicles as they are ready — not before. Tell us what you are looking for and we will let you know when something fits.",
  "home.inventory.empty.call": "Call {phone}",
  "home.inventory.empty.email": "Tell us what you need",
  "home.inventory.empty.mailSubject": "Vehicle request — {name}",
  "home.inventory.empty.recheck": "Check inventory again",

  // ---- Homepage: four-step journey ---------------------------------------
  "home.journey.eyebrow": "How it works",
  "home.journey.title": "Four steps, no guesswork",
  "home.journey.subtitle": "The same process whether you pay cash or finance.",
  "home.journey.1.title": "Browse",
  "home.journey.1.body": "Explore real available inventory.",
  "home.journey.2.title": "Compare",
  "home.journey.2.body": "See price, photos and vehicle details.",
  "home.journey.3.title": "Build your deal",
  "home.journey.3.body": "Review options that fit your budget.",
  "home.journey.4.title": "Drive with confidence",
  "home.journey.4.body": "Complete the next steps with clear information.",
  "home.journey.cta": "Start with the cars",

  // ---- Homepage: buying options band -------------------------------------
  "home.options.eyebrow": "Buying options",
  "home.options.title": "Multiple ways to buy.\nOne {{simple experience.}}",
  "home.options.subtitle":
    "Choose the structure that fits your budget. We will walk through the numbers with you before anything is decided.",
  "home.options.cash.title": "Pay cash",
  "home.options.cash.body": "Agree the price, complete the paperwork, take the keys.",
  "home.options.finance.title": "Traditional financing",
  "home.options.finance.body": "Apply with a lender, with guidance through the process.",
  "home.options.guided.title": "Guided deal structuring",
  "home.options.guided.body": "Bring a budget and see the terms that fit it.",
  "home.options.flexible.title": "Lease / lease-to-own",
  "home.options.flexible.body": "Ask what applies to the vehicle you are considering.",
  "home.options.disclaimerLabel": "About financing:",
  "home.options.disclaimer":
    "payment, term and rate figures are estimates for planning only — not a loan offer, not a credit decision, and not a guarantee of approval. Final terms come from the lender and depend on your application.",

  // ---- Homepage: Nexo family story ---------------------------------------
  "home.family.eyebrow": "Part of the Nexo family",
  "home.family.title": "More than a car.\nA better {{tomorrow.}}",
  "home.family.body":
    "Nexo Auto is part of the Nexo family — the same team behind Nexo Rental. Built around a simple idea: make everyday services easier to understand and easier to use.",
  "home.family.cta": "Browse inventory",
  "home.family.note": "The same drive, a simpler way forward.",

  // ---- Vehicle card -------------------------------------------------------
  "card.photosSoon": "Photos coming soon",
  "card.askingPrice": "Asking price",
  "card.explore": "View",
  "card.viewAction": "View {vehicle}, stock number {stock}, {price}",
  "card.photoAlt": "Photo of {vehicle}",
  "card.noPhoto": "Photo coming soon",

  // ---- Inventory index ----------------------------------------------------
  "inventory.breadcrumbHome": "Home",
  "inventory.breadcrumbCurrent": "Inventory",
  "inventory.title": "Find the right car for your next chapter.",
  "inventory.intro": "Everything currently listed by {name}, with the asking price shown up front.",
  "inventory.searchLabel": "Search inventory by make, model, VIN or stock number",
  "inventory.searchPlaceholder": "Make, model, VIN…",
  "inventory.searchAction": "Search",
  "inventory.resultsMatching": "Results for {query}",
  "inventory.resultsCountOne": "{count} vehicle listed",
  "inventory.resultsCountOther": "{count} vehicles listed",
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
    "Ask us to confirm availability, arrange a look, or walk through the numbers with you.",
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
  "footer.browseInventory": "Inventory",
  "footer.howItWorks": "How it works",
  "footer.buyingOptions": "Financing",
  "footer.whyNexo": "About",
  "footer.talkToUs": "Contact",
  "footer.noContact": "Contact details appear here once they are configured in dealer settings.",
  "footer.financeNote": "Financing figures on listings are estimates, never approvals.",
  "footer.rights": "© {year} {name}. All rights reserved.",
  "footer.taglineFallback":
    "Carefully selected used cars, clear pricing, and a straightforward path from browsing to keys.",
  "footer.appearance": "Appearance",

  // ---- Customer-visible failure states -----------------------------------
  "error.genericTitle": "Something went wrong",
  "error.genericBody": "Please try again. If it keeps happening, call or email us and we will help directly.",
} as const;
