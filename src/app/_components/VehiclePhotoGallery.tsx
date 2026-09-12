"use client";

import { useState } from "react";
import { type PublicVehiclePhoto } from "@/lib/public-catalog";
import { Car, ChevronLeft, ChevronRight } from "lucide-react";
import { strings, type Language } from "@/lib/i18n/catalog";

/**
 * Vehicle photo gallery.
 *
 * Client-side because paging through photos is interaction, but the state is
 * only an index and a set of failed URLs — no library, no preloading heuristics.
 * All labels arrive translated through `s`, including the `aria-label`s on the
 * arrows and thumbnails, so the gallery is fully usable in either language.
 *
 * The `language` prop is optional and defaults to English because the OPERATOR
 * surfaces also render this gallery, and the operator application is
 * intentionally English-only in this phase. Public pages always pass the
 * request language explicitly.
 */

interface VehiclePhotoGalleryProps {
  photos: PublicVehiclePhoto[];
  vehicleTitle: string;
  language?: Language;
}

export function VehiclePhotoGallery({
  photos,
  vehicleTitle,
  language = "en",
}: VehiclePhotoGalleryProps) {
  const s = strings(language);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  const hasPhotos = photos.length > 0;
  const currentPhoto = hasPhotos ? photos[currentIndex] : null;
  const isCurrentFailed = currentPhoto ? imageErrorMap[currentPhoto.id] : true;
  const hasMultiple = photos.length > 1;

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % photos.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length);
  };

  const handleImageError = (photoId: string) => {
    setImageErrorMap((prev) => ({ ...prev, [photoId]: true }));
  };

  return (
    <div className="space-y-3">
      {/* Main viewport */}
      <div className="relative flex aspect-16/10 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {hasPhotos && currentPhoto && !isCurrentFailed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={currentPhoto.url}
            alt={currentPhoto.alt || vehicleTitle}
            className="h-full w-full object-cover"
            onError={() => handleImageError(currentPhoto.id)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-slate-100 p-6 text-center">
            <Car className="mb-2 h-14 w-14 text-slate-300" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-600">{vehicleTitle}</span>
            <span className="mt-0.5 text-xs text-slate-400">{s.t("gallery.placeholder")}</span>
          </div>
        )}

        {/* Carousel controls, only when there is more than one photo */}
        {hasPhotos && hasMultiple && (
          <>
            <button
              onClick={handlePrev}
              type="button"
              aria-label={s.t("gallery.previous")}
              className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-colors hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              onClick={handleNext}
              type="button"
              aria-label={s.t("gallery.next")}
              className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-colors hover:bg-white"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="absolute bottom-3 right-3 rounded-md bg-slate-900/80 px-2.5 py-1 font-mono text-[11px] text-white">
              {s.tc("gallery.counter", { current: currentIndex + 1, total: photos.length })}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {hasPhotos && hasMultiple && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {photos.map((photo, idx) => {
            const isFailed = imageErrorMap[photo.id];
            const isSelected = idx === currentIndex;

            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                aria-label={s.tc("gallery.thumbnail", { index: idx + 1, total: photos.length })}
                aria-current={isSelected ? "true" : undefined}
                className={`relative aspect-16/10 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-slate-100 transition-all ${
                  isSelected
                    ? "border-orange-600 ring-2 ring-orange-500/30"
                    : "border-slate-200 opacity-70 hover:opacity-100"
                }`}
              >
                {!isFailed ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => handleImageError(photo.id)}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-slate-100">
                    <Car className="h-4 w-4 text-slate-300" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
