import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatCents } from "@/lib/money";
import { getPublicDealerInfo, getPublicVehicle } from "@/lib/public-catalog";
import { PublicNav } from "@/app/_components/PublicNav";
import { PublicFooter } from "@/app/_components/PublicFooter";
import { StatusBadge } from "@/app/_components/StatusBadge";
import { VehiclePhotoGallery } from "@/app/_components/VehiclePhotoGallery";
import {
  ChevronRight,
  Phone,
  Mail,
  Shield,
  CheckCircle2,
  Calendar,
  Gauge,
  Tag,
  Key,
  HelpCircle,
  FileCheck,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ vehicleId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { vehicleId } = await params;
  const vehicle = await getPublicVehicle(vehicleId);
  if (!vehicle) {
    return { title: "Vehicle Not Found · Nexo Auto" };
  }
  return {
    title: `${vehicle.year} ${vehicle.make} ${vehicle.model} · Nexo Auto`,
    description: vehicle.description || `Explore this ${vehicle.year} ${vehicle.make} ${vehicle.model} at Nexo Auto.`,
  };
}

export default async function VehicleDetailPage({ params }: PageProps) {
  const { vehicleId } = await params;
  const [vehicle, dealer] = await Promise.all([
    getPublicVehicle(vehicleId),
    getPublicDealerInfo(),
  ]);

  if (!vehicle) {
    notFound();
  }

  const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.trim ? ` ${vehicle.trim}` : ""}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-orange-500 selection:text-white">
      <PublicNav />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Link href="/" className="hover:text-orange-600 transition-colors">
            Home
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <Link href="/inventory" className="hover:text-orange-600 transition-colors">
            Inventory
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-800 font-semibold truncate">{title}</span>
        </div>

        {/* Vehicle Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {title}
              </h1>
              <StatusBadge
                status={vehicle.availability === "RESERVED" ? "RESERVED" : "AVAILABLE"}
                size="md"
              />
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-slate-500">
              <span>Stock #{vehicle.stockNumber}</span>
              <span>•</span>
              <span>VIN: {vehicle.vin}</span>
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-xs text-slate-500 font-mono uppercase">Asking Price:</span>
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900">
              {formatCents(vehicle.askingPriceCents)}
            </span>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Photo Gallery & Overview */}
          <div className="lg:col-span-7 space-y-6">
            <div className="p-4 sm:p-5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <VehiclePhotoGallery photos={vehicle.photos} vehicleTitle={title} />
            </div>

            {/* Description Card */}
            {vehicle.description && (
              <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
                <h2 className="text-base font-bold text-slate-900">Vehicle Description</h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                  {vehicle.description}
                </p>
              </div>
            )}

            {/* Features & Options */}
            {vehicle.features && vehicle.features.length > 0 && (
              <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
                <h2 className="text-base font-bold text-slate-900">Key Features & Equipment</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                  {vehicle.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Key Specifications & Inquiry Box */}
          <div className="lg:col-span-5 space-y-6">
            {/* Direct Inquiry Contact Box */}
            <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div className="space-y-1 border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">Interested in this vehicle?</h3>
                <p className="text-xs text-slate-500">
                  Contact us to verify availability, schedule a test drive, or discuss purchase options.
                </p>
              </div>

              <div className="space-y-3">
                {dealer?.phone && (
                  <a
                    href={`tel:${dealer.phone}`}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold text-xs transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    <span>Call {dealer.phone}</span>
                  </a>
                )}

                {dealer?.email && (
                  <a
                    href={`mailto:${dealer.email}?subject=Inquiry regarding ${encodeURIComponent(title)} (Stock %23${vehicle.stockNumber})`}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs border border-slate-200 transition-colors"
                  >
                    <Mail className="w-4 h-4 text-slate-500" />
                    <span>Email About This Vehicle</span>
                  </a>
                )}
              </div>
            </div>

            {/* Specifications Matrix */}
            <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-slate-900">Vehicle Specifications</h3>
              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Mileage</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {vehicle.mileage.toLocaleString("en-US")} miles
                  </span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Exterior Color</span>
                  <span className="font-medium text-slate-900">{vehicle.exteriorColor || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Interior Color</span>
                  <span className="font-medium text-slate-900">{vehicle.interiorColor || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Transmission</span>
                  <span className="font-medium text-slate-900">{vehicle.transmission || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Drivetrain</span>
                  <span className="font-medium text-slate-900">{vehicle.drivetrain || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Engine</span>
                  <span className="font-medium text-slate-900">{vehicle.engine || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Fuel Type</span>
                  <span className="font-medium text-slate-900">{vehicle.fuelType || "N/A"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Title Status</span>
                  <span className="font-mono font-bold text-emerald-700">{vehicle.titleStatus}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-slate-500">Location</span>
                  <span className="font-medium text-slate-900">{vehicle.location || "N/A"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter dealerInfo={dealer} />
    </div>
  );
}
