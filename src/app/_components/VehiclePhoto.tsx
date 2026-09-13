"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A listing photograph that can fall back to server-rendered placeholder markup.
 *
 * WHY THIS IS THE ONLY CLIENT PART OF A VEHICLE CARD
 * A photograph URL comes from the database and can rot: a storage object can be
 * deleted, or a bucket can stop resolving, and the card must not show a broken
 * image when that happens. That is the entire reason a vehicle card used to be a
 * Client Component — and being one dragged the whole public dictionary
 * (`strings()`, both languages, ~25 KB) into the browser bundle for the landing
 * page, plus a hydration pass for every card.
 *
 * So the boundary is now this: one `useState`, no copy, no icons, no formatting.
 * The fallback is passed in as `children` from a Server Component, so the mark
 * and the label inside it are rendered on the server and cost no client
 * JavaScript at all.
 *
 * WHY THERE ARE TWO FAILURE CHECKS
 * `onError` alone is not enough, and this is not theoretical: a listing photo is
 * `loading="lazy"` and a 404 comes back in milliseconds, so the image frequently
 * fails BEFORE React has hydrated and attached the handler. React then never
 * hears about it and the visitor gets a broken image — verified against a real
 * dead object on the real server, where the fallback did not appear.
 *
 * The mount check closes that window: an image that is already `complete` with
 * no intrinsic width has failed, whenever it failed. Between them the two paths
 * cover both orders, and neither can double-fire (the state is set once).
 *
 * It renders the photograph during SSR, which is what the browser receives, so
 * there is no hydration mismatch and no layout shift when a photo does load:
 * the fallback occupies exactly the same box.
 */
export function VehiclePhoto({
  src,
  alt,
  className,
  children,
}: {
  src: string;
  alt: string;
  /** Applied to the `<img>`: sizing, crop and the hover settle. */
  className: string;
  /** Server-rendered placeholder markup, shown only if the image fails. */
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    // A failed image is `complete` and reports no intrinsic size. Safe to test
    // unconditionally: a loaded image has a non-zero naturalWidth.
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <>{children}</>;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
