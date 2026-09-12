import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatCents } from "@/lib/money";
import { getPublicDealerInfo, getPublicVehicle } from "@/lib/public-catalog";
import { getPublicStrings, type PublicStrings } from "@/lib/i18n";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { VehiclePhotoGallery } from "@/app/_components/VehiclePhotoGallery";
import { SECTION_IDS } from "@/lib/i18n/public-content";
import { ArrowLeft, ArrowRight, Calculator, CheckCircle2, ChevronRight, Mail, MessageSquare, Phone } from "lucide-react";

/**
 * Public vehicle detail page.
 *
 * Presentation only: the read still goes through `getPublicVehicle`, which is
 * the approved public view. The page keeps the two questions a buyer has ("is
 * this the car?" and "what does it cost?") as the two loudest elements, then
 * answers the third ("how do I move on it?") in the sidebar.
 *
 * No financing figure is invented here. The page links to the buying-options
 * section instead, where the estimate-not-an-approval language lives.
 *
 * Bilingual: labels, specifications and calls to action are translated, while
 * the vehicle itself — VIN, stock number, make, model, trim, colours,
 * description — is passed through untouched in both languages.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ vehicleId }, query] = await Promise.all([params, searchParams]);
  const [vehicle, s] = await Promise.all([
    getPublicVehicle(vehicleId),
    getPublicStrings({ searchParam: query.lang ?? null }),
  ]);

  if (!vehicle) {
    return { title: s.t("vehicle.notFoundTitle") };
  }

  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;

  return {
    title,
    description:
      vehicle.description ||
      s.tc("meta.vehicle.description", {
        vehicle: title,
        mileage: s.n(vehicle.mileage),
        price: formatCents(vehicle.askingPriceCents),
      }),
  };
}

interface SpecSource {
  mileage: number;
  exteriorColor: string | null;
  interiorColor: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  fuelType: string | null;
  bodyType: string | null;
  titleStatus: string;
  location: string | null;
}

/**
 * Specification rows. The DATA is never translated; only the labels and the
 * fallback for a value the dealer has not recorded.
 */
function specRows(vehicle: SpecSource, s: PublicStrings): Array<{ label: string; value: string; mono: boolean }> {
  const missing = s.t("spec.notRecorded");
  return [
    { label: s.t("spec.mileage"), value: s.tc("spec.miles", { count: s.n(vehicle.mileage) }), mono: true },
    { label: s.t("spec.exteriorColor"), value: vehicle.exteriorColor || missing, mono: false },
    { label: s.t("spec.interiorColor"), value: vehicle.interiorColor || missing, mono: false },
    { label: s.t("spec.transmission"), value: vehicle.transmission || missing, mono: false },
    { label: s.t("spec.drivetrain"), value: vehicle.drivetrain || missing, mono: false },
    { label: s.t("spec.engine"), value: vehicle.engine || missing, mono: false },
    { label: s.t("spec.fuelType"), value: vehicle.fuelType || missing, mono: false },
    { label: s.t("spec.bodyType"), value: vehicle.bodyType || missing, mono: false },
    // Title status is a stored token ("CLEAN"), shown as-is in both languages:
    // it is data, not interface copy.
    { label: s.t("spec.titleStatus"), value: vehicle.titleStatus, mono: true },
    { label: s.t("spec.location"), value: vehicle.location || missing, mono: false },
  ];
}

export default async function VehicleDetailPage({ params, searchParams }: PageProps) {
  const [{ vehicleId }, query] = await Promise.all([params, searchParams]);

  const [vehicle, dealer, s] = await Promise.all([
    getPublicVehicle(vehicleId),
    getPublicDealerInfo(),
    getPublicStrings({ searchParam: query.lang ?? null }),
  ]);

  if (!vehicle) {
    notFound();
  }

  const name = dealer?.name?.trim() || s.t("meta.siteName");
  const phone = dealer?.phone?.trim() || null;
  const email = dealer?.email?.trim() || null;
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, "")}` : null;

  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;
  const price = formatCents(vehicle.askingPriceCents);
  const isReserved = vehicle.availability === "RESERVED";
  const isDemo = vehicle.dataOrigin === "DEMO";
  const specs = specRows(vehicle, s);
  const mailtoSubject = s.tc("vehicle.mailSubject", { vehicle: title, stock: vehicle.stockNumber });
  const languageQuery = query.lang ? `?lang=${query.lang}` : "";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <PublicNav dealerInfo={dealer} language={s.language} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-5">
          <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <li>
              <Link href={languageQuery ? `/${languageQuery}` : "/"} className="transition-colors hover:text-orange-700">
                {s.t("inventory.breadcrumbHome")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            </li>
            <li>
              <Link href={`/inventory${languageQuery}`} className="transition-colors hover:text-orange-700">
                {s.t("inventory.breadcrumbCurrent")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            </li>
            <li className="max-w-[14rem] truncate font-semibold text-slate-800 sm:max-w-none">{title}</li>
          </ol>
        </nav>

        {/* Vehicle identity + price. Navy panel so the price reads first. */}
        <section className="brand-panel overflow-hidden rounded-2xl">
          <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={isReserved ? "RESERVED" : "AVAILABLE"}
                  label={isReserved ? s.t("status.reserved") : s.t("status.available")}
                  size="md"
                />
                {isDemo && <StatusBadge status="DEMO" label={s.t("status.demo")} size="md" />}
              </div>

              <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">
                {title}
              </h1>

              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-slate-300 sm:text-xs">
                <span>{s.tc("spec.stockNumber", { stock: vehicle.stockNumber })}</span>
                <span aria-hidden="true" className="text-slate-500">
                  •
                </span>
                <span className="break-all">{s.tc("spec.vin", { vin: vehicle.vin })}</span>
              </p>
            </div>

            <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-5 py-4 lg:text-right">
              <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">
                {s.t("vehicle.askingPrice")}
              </span>
              <span className="mt-1 block font-mono text-3xl font-extrabold leading-none text-white sm:text-4xl">
                {price}
              </span>
              <span className="mt-2 block text-[11px] text-slate-400">{s.t("vehicle.priceNote")}</span>
            </div>
          </div>
        </section>

        {/* Main content */}
        <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-12 lg:gap-8">
          {/* Left: gallery, description, equipment */}
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
              <VehiclePhotoGallery photos={vehicle.photos} vehicleTitle={title} language={s.language} />
            </div>

            {vehicle.description && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-slate-900">{s.t("vehicle.about")}</h2>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {vehicle.description}
                </p>
              </section>
            )}

            {vehicle.features && vehicle.features.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-slate-900">{s.t("vehicle.features")}</h2>
                <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {vehicle.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-orange-600" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Right: contact + specifications */}
          <div className="space-y-6 lg:col-span-5">
            {/* Contact card — sticks alongside on large screens. */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 lg:sticky lg:top-20">
              <h2 className="text-base font-bold tracking-tight text-slate-900">{s.t("vehicle.interestedTitle")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.t("vehicle.interestedBody")}</p>

              <div className="mt-5 space-y-3">
                {phone && telHref && (
                  <a
                    href={telHref}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span>{s.tc("vehicle.call", { phone })}</span>
                  </a>
                )}

                {email && (
                  <a
                    href={`mailto:${email}?subject=${encodeURIComponent(mailtoSubject)}`}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                  >
                    <Mail className="h-4 w-4 text-orange-600" aria-hidden="true" />
                    <span>{s.t("vehicle.emailAction")}</span>
                  </a>
                )}

                {!phone && !email && (
                  <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    <span>{s.t("vehicle.noContact")}</span>
                  </p>
                )}
              </div>

              {/* Financing entry point — points at the explanation, never a promise. */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <Link
                  href={`/#${SECTION_IDS.buyingOptions}`}
                  className="inline-flex items-start gap-1.5 text-xs font-semibold text-orange-700 transition-colors hover:text-orange-800"
                >
                  <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{s.t("vehicle.optionsLink")}</span>
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Link>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{s.t("vehicle.financeNote")}</p>
              </div>
            </section>

            {/* Specifications */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
              <h2 className="text-base font-bold tracking-tight text-slate-900">{s.t("vehicle.specs")}</h2>
              <dl className="mt-3 divide-y divide-slate-100 text-sm">
                {specs.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                    <dt className="text-slate-500">{row.label}</dt>
                    <dd className={`text-right font-medium text-slate-900 ${row.mono ? "font-mono" : ""}`}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <Link
              href={`/inventory${languageQuery}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 transition-colors hover:text-orange-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{s.tc("vehicle.backToInventory", { name })}</span>
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter dealerInfo={dealer} language={s.language} />
    </div>
  );
}
