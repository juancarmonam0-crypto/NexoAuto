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
 * SHAPE (the landing's art direction)
 *   hero → inventory → four-step route → navy buying-options slab →
 *   Nexo family → closing conversion moment → dark footer
 *
 * Every section uses a DIFFERENT visual grammar on purpose — a photographic
 * editorial grid, a connected route, a ledger, a brand plate, a closing panel —
 * so the page reads as one art-directed experience instead of the same card
 * grid repeated at intervals.
 */

export interface HeroAssurance {
  key: TranslationKey;
  bodyKey: TranslationKey;
}

/**
 * Exactly three compact cards under the hero actions.
 *
 * These are the page's "spec strip", and every line describes something the
 * public listing genuinely contains: the asking price, the vehicle's own
 * details and photographs, and the buying structures the dealership can
 * actually offer. Nothing here claims an inspection, a history report, a
 * warranty or a quality standard the product cannot evidence.
 */
export const HERO_ASSURANCES: readonly HeroAssurance[] = [
  { key: "home.hero.specPrice", bodyKey: "home.hero.specPriceBody" },
  { key: "home.hero.specDetails", bodyKey: "home.hero.specDetailsBody" },
  { key: "home.hero.specOptions", bodyKey: "home.hero.specOptionsBody" },
] as const;

export interface JourneyStep {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

/**
 * Four steps, one to two lines each. No walls of text.
 *
 * The titles are deliberately verbs a buyer would use about themselves
 * ("Find your car", "Take the keys") rather than process nouns, because the
 * journey section's job is to make the next action obvious.
 */
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
