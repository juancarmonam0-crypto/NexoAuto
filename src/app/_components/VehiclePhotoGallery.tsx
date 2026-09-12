"use client";

import { useState } from "react";
import { type PublicVehiclePhoto } from "@/lib/public-catalog";
import { Car, ChevronLeft, ChevronRight } from "lucide-react";

interface VehiclePhotoGalleryProps {
  photos: PublicVehiclePhoto[];
  vehicleTitle: string;
}

export function VehiclePhotoGallery({ photos, vehicleTitle }: VehiclePhotoGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  const hasPhotos = photos && photos.length > 0;
  const currentPhoto = hasPhotos ? photos[currentIndex] : null;
  const isCurrentFailed = currentPhoto ? imageErrorMap[currentPhoto.id] : true;

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
      {/* Main Viewport */}
      <div className="relative aspect-16/10 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
        {hasPhotos && currentPhoto && !isCurrentFailed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={currentPhoto.url}
            alt={currentPhoto.alt || vehicleTitle}
            className="w-full h-full object-cover"
            onError={() => handleImageError(currentPhoto.id)}
          />
        ) : (
          /* Automotive Placeholder */
          <div className="w-full h-full bg-slate-100 flex flex-col items-center justify-center p-6 text-center text-slate-400">
            <Car className="w-14 h-14 text-slate-300 mb-2" />
            <span className="text-sm font-semibold text-slate-600">{vehicleTitle}</span>
            <span className="text-xs text-slate-400 mt-0.5">Photo placeholder</span>
          </div>
        )}

        {/* Carousel controls if multiple photos */}
        {hasPhotos && photos.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              type="button"
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white text-slate-700 shadow-md transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNext}
              type="button"
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 hover:bg-white text-slate-700 shadow-md transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-md bg-slate-900/80 text-white text-[11px] font-mono">
              {currentIndex + 1} / {photos.length}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {hasPhotos && photos.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {photos.map((photo, idx) => {
            const isFailed = imageErrorMap[photo.id];
            const isSelected = idx === currentIndex;

            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`relative w-20 aspect-16/10 rounded-lg overflow-hidden border shrink-0 bg-slate-100 transition-all ${
                  isSelected ? "border-orange-600 ring-2 ring-orange-500/30" : "border-slate-200 opacity-70 hover:opacity-100"
                }`}
              >
                {!isFailed ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo.url}
                    alt={photo.alt || `Thumbnail ${idx + 1}`}
                    className="w-full h-full object-cover"
                    onError={() => handleImageError(photo.id)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-slate-100">
                    <Car className="w-4 h-4 text-slate-300" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
