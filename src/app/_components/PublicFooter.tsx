import Link from "next/link";
import { type PublicDealerInfo } from "@/lib/public-catalog";
import { Phone, Mail, MapPin, Lock } from "lucide-react";

interface PublicFooterProps {
  dealerInfo?: PublicDealerInfo | null;
}

export function PublicFooter({ dealerInfo }: PublicFooterProps) {
  const name = dealerInfo?.name ?? "Nexo Auto";
  const address = [dealerInfo?.addressLine1, dealerInfo?.city, dealerInfo?.state, dealerInfo?.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <footer className="bg-slate-50 border-t border-slate-200 text-slate-600 text-xs py-10 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand & Description */}
          <div className="space-y-2">
            <span className="font-extrabold text-sm text-slate-900 tracking-tight block">
              {name.toUpperCase()}
            </span>
            <p className="text-slate-500 text-xs leading-relaxed max-w-sm">
              {dealerInfo?.tagline ?? "Used vehicles, clearly presented."}
            </p>
          </div>

          {/* Contact Details */}
          <div className="space-y-2">
            <span className="font-semibold text-slate-900 text-xs uppercase tracking-wider block">
              Contact & Location
            </span>
            <div className="space-y-1 text-slate-600">
              {dealerInfo?.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{dealerInfo.phone}</span>
                </div>
              )}
              {dealerInfo?.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>{dealerInfo.email}</span>
                </div>
              )}
              {address && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <span>{address}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Links & Operator Portal */}
          <div className="space-y-2">
            <span className="font-semibold text-slate-900 text-xs uppercase tracking-wider block">
              Navigation
            </span>
            <ul className="space-y-1.5">
              <li>
                <Link href="/inventory" className="hover:text-orange-600 transition-colors">
                  View Inventory
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/login"
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <Lock className="w-3 h-3" />
                  <span>Operator Login</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-400 text-[11px]">
          <p>© {new Date().getFullYear()} {name}. All rights reserved.</p>
          <p>Nexo Auto.</p>
        </div>
      </div>
    </footer>
  );
}
