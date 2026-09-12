import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Calculator,
  Car,
  CheckCircle2,
  ClipboardList,
  Gauge,
  HandCoins,
  KeyRound,
  MessageSquare,
  Route,
  ShieldCheck,
  Smartphone,
  Tag,
  Wallet,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/catalog";

/**
 * The landing page's content STRUCTURE — which sections exist, in what order,
 * with which icons and which destination each action points at.
 *
 * Deliberately no prose. Every user-visible string is a translation key, so the
 * English and Spanish editions are the same page with two dictionaries behind
 * it. That is also what makes the copy testable without rendering a page: the
 * key lists below can be checked for completeness in both languages.
 *
 * Icons stay here rather than in `src/app/page.tsx` because the icon and its
 * copy belong to the same decision — a card that says "Built for your phone"
 * with a wrench icon is an editorial mistake, and keeping them adjacent makes
 * it a visible one.
 */

export interface Benefit {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export const BENEFITS: readonly Benefit[] = [
  {
    icon: Tag,
    titleKey: "home.benefits.pricing.title",
    bodyKey: "home.benefits.pricing.body",
  },
  {
    icon: Calculator,
    titleKey: "home.benefits.market.title",
    bodyKey: "home.benefits.market.body",
  },
  {
    icon: Wallet,
    titleKey: "home.benefits.options.title",
    bodyKey: "home.benefits.options.body",
  },
  {
    icon: Smartphone,
    titleKey: "home.benefits.mobile.title",
    bodyKey: "home.benefits.mobile.body",
  },
  {
    icon: BadgeCheck,
    titleKey: "home.benefits.selection.title",
    bodyKey: "home.benefits.selection.body",
  },
] as const;

export interface Step {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export const STEPS: readonly Step[] = [
  { icon: Car, titleKey: "home.steps.1.title", bodyKey: "home.steps.1.body" },
  { icon: ClipboardList, titleKey: "home.steps.2.title", bodyKey: "home.steps.2.body" },
  { icon: MessageSquare, titleKey: "home.steps.3.title", bodyKey: "home.steps.3.body" },
  { icon: KeyRound, titleKey: "home.steps.4.title", bodyKey: "home.steps.4.body" },
] as const;

export interface BuyingOption {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  pointKeys: readonly TranslationKey[];
}

export const BUYING_OPTIONS: readonly BuyingOption[] = [
  {
    icon: Banknote,
    titleKey: "home.options.cash.title",
    bodyKey: "home.options.cash.body",
    pointKeys: ["home.options.cash.point1", "home.options.cash.point2", "home.options.cash.point3"],
  },
  {
    icon: HandCoins,
    titleKey: "home.options.finance.title",
    bodyKey: "home.options.finance.body",
    pointKeys: [
      "home.options.finance.point1",
      "home.options.finance.point2",
      "home.options.finance.point3",
    ],
  },
  {
    icon: Calculator,
    titleKey: "home.options.guided.title",
    bodyKey: "home.options.guided.body",
    pointKeys: [
      "home.options.guided.point1",
      "home.options.guided.point2",
      "home.options.guided.point3",
    ],
  },
  {
    icon: Route,
    titleKey: "home.options.flexible.title",
    bodyKey: "home.options.flexible.body",
    pointKeys: [
      "home.options.flexible.point1",
      "home.options.flexible.point2",
      "home.options.flexible.point3",
    ],
  },
] as const;

export interface TrustPoint {
  icon: LucideIcon;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export const TRUST_POINTS: readonly TrustPoint[] = [
  { icon: ShieldCheck, titleKey: "home.trust.process.title", bodyKey: "home.trust.process.body" },
  { icon: Gauge, titleKey: "home.trust.car.title", bodyKey: "home.trust.car.body" },
  { icon: MessageSquare, titleKey: "home.trust.people.title", bodyKey: "home.trust.people.body" },
  { icon: CheckCircle2, titleKey: "home.trust.pressure.title", bodyKey: "home.trust.pressure.body" },
] as const;

/** Hero assurance strip: short, verifiable capability statements only. */
export const HERO_ASSURANCE_KEYS = [
  "home.hero.assuranceInventory",
  "home.hero.assurancePricing",
  "home.hero.assuranceFinancing",
] as const satisfies readonly TranslationKey[];

/** The sixth benefit cell is a call to action, not another claim. */
export const BENEFIT_CTA_ICON = ArrowRight;
export const BENEFIT_CTA_TITLE_KEY: TranslationKey = "home.benefits.cta.title";
export const BENEFIT_CTA_BODY_KEY: TranslationKey = "home.benefits.cta.body";
export const BENEFIT_CTA_ACTION_KEY: TranslationKey = "home.benefits.cta.action";

/**
 * Anchor ids used by the header, footer and hero links.
 *
 * They live here so a link and its target cannot drift: a section renamed in
 * `page.tsx` without updating the constant becomes a visible bug immediately
 * rather than a silently dead anchor.
 */
export const SECTION_IDS = {
  inventory: "inventory",
  whyNexo: "why-nexo",
  howItWorks: "how-it-works",
  buyingOptions: "buying-options",
} as const;
