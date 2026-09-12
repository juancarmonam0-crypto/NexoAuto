import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Banknote,
  Car,
  Compass,
  FileText,
  HandCoins,
  KeyRound,
  Route,
  Search,
  ShieldCheck,
  Tag,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/catalog";

/**
 * The homepage's content STRUCTURE — which sections exist, in what order, with
 * which icons and which destination each action points at.
 *
 * Deliberately no prose. Every user-visible string is a translation key, so the
 * English and Spanish editions are the same page with two dictionaries behind
 * it. That is also what makes the copy testable without rendering a page: the
 * key lists below are checked for completeness in both languages.
 *
 * SHAPE (from the approved mockup)
 *   hero → inventory → four-step journey → navy buying-options band →
 *   Nexo family story → dark footer
 *
 * The previous six-card explainer grid is GONE on purpose: the mockup shows cars
 * early and explains the business in four short steps, and a marketing page for a
 * dealership should sell the cars, not the software.
 */

export interface HeroAssurance {
  key: TranslationKey;
  bodyKey: TranslationKey;
}

/**
 * Exactly three compact credentials under the hero actions — the mockup's
 * restraint. Icons support them; they are not the design.
 */
export const HERO_ASSURANCES: readonly HeroAssurance[] = [
  { key: "home.hero.assurancePricing", bodyKey: "home.hero.assurancePricingBody" },
  { key: "home.hero.assuranceSelection", bodyKey: "home.hero.assuranceSelectionBody" },
  { key: "home.hero.assuranceFinancing", bodyKey: "home.hero.assuranceFinancingBody" },
] as const;

export interface JourneyStep {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

/** Four steps, one to two lines each. No walls of text. */
export const JOURNEY_STEPS: readonly JourneyStep[] = [
  { icon: Search, titleKey: "home.journey.1.title", bodyKey: "home.journey.1.body" },
  { icon: Compass, titleKey: "home.journey.2.title", bodyKey: "home.journey.2.body" },
  { icon: FileText, titleKey: "home.journey.3.title", bodyKey: "home.journey.3.body" },
  { icon: KeyRound, titleKey: "home.journey.4.title", bodyKey: "home.journey.4.body" },
] as const;

export interface BuyingOption {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

/**
 * The navy buying-options band.
 *
 * These four are the structures the dealership can actually describe today. The
 * copy for each states the mechanism, never an outcome: "apply with a lender,
 * with guidance" — not "get approved".
 */
export const BUYING_OPTIONS: readonly BuyingOption[] = [
  { icon: Banknote, titleKey: "home.options.cash.title", bodyKey: "home.options.cash.body" },
  { icon: HandCoins, titleKey: "home.options.finance.title", bodyKey: "home.options.finance.body" },
  { icon: FileText, titleKey: "home.options.guided.title", bodyKey: "home.options.guided.body" },
  { icon: Route, titleKey: "home.options.flexible.title", bodyKey: "home.options.flexible.body" },
] as const;

/** Icons used by the homepage's own headings and empty states. */
export const HERO_ICON = Car;
export const INVENTORY_ICON = Tag;
export const FAMILY_ICON = ShieldCheck;
export const BADGE_ICON = BadgeCheck;

/**
 * Anchor ids used by the header, footer and in-page links.
 *
 * They live here so a link and its target cannot drift: a section renamed in
 * `page.tsx` without updating the constant becomes a visible bug immediately
 * rather than a silently dead anchor.
 */
export const SECTION_IDS = {
  inventory: "inventory",
  journey: "how-it-works",
  buyingOptions: "financing",
  family: "about",
  contact: "contact",
} as const;
