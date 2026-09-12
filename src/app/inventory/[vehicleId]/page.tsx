import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { getPublicVehicle } from "@/lib/public-catalog";

/**
 * Public vehicle detail.
 *
 * `getPublicVehicle()` returns null for anything that is not published, priced
 * and LISTED/RESERVED — sold, unlisted and simply-wrong ids are indistinguishable
 * to a visitor, which is exactly the intent.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ vehicleId: string }>;
}

function spec(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <span className="muted">{label}: </span>
      {value}
    </div>
  );
}

export default async function VehicleDetailPage({ params }: PageProps) {
  const { vehicleId } = await params;
  const vehicle = await getPublicVehicle(vehicleId);
  if (!vehicle) notFound();

  return (
    <main>
      <p>
        <Link href="/inventory">← Inventory</Link>
      </p>

      <h1>
        {vehicle.year} {vehicle.make} {vehicle.model}
        {vehicle.trim ? ` ${vehicle.trim}` : ""}
      </h1>

      <p>
        <strong>{formatCents(vehicle.askingPriceCents)}</strong>
        {" · "}
        {vehicle.mileage.toLocaleString("en-US")} miles
        {" · "}
        {vehicle.availability === "RESERVED" ? "Reserved" : "Available"}
      </p>

      {vehicle.dataOrigin === "DEMO" ? (
        <p className="banner banner-error">Demo data — this vehicle is sample inventory, not a real listing.</p>
      ) : null}

      {vehicle.photos.length > 0 ? (
        <div className="row">
          {vehicle.photos.map((photo) => (
            // `next/image` would need a configured loader, and photo BYTES are
            // not served over HTTP yet (see AI_STUDIO_UI_CONTRACT.md §10). A
            // plain <img> is the honest placeholder until delivery is wired;
            // the URL itself is produced by the storage boundary.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt={photo.alt ?? `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              width={320}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}

      {vehicle.description ? <p>{vehicle.description}</p> : null}

      <h2>Specification</h2>
      <div className="card">
        {spec("Stock number", vehicle.stockNumber)}
        {spec("VIN", vehicle.vin)}
        {spec("Exterior", vehicle.exteriorColor)}
        {spec("Interior", vehicle.interiorColor)}
        {spec("Transmission", vehicle.transmission)}
        {spec("Drivetrain", vehicle.drivetrain)}
        {spec("Engine", vehicle.engine)}
        {spec("Fuel", vehicle.fuelType)}
        {spec("Body", vehicle.bodyType)}
        {spec("Doors", vehicle.doors)}
        {spec("Seats", vehicle.seats)}
        {spec("Title", vehicle.titleStatus)}
        {spec("Location", vehicle.location)}
      </div>

      {vehicle.features.length > 0 ? (
        <>
          <h2>Features</h2>
          <ul>
            {vehicle.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="muted">
        Call or use the contact form to arrange a test drive. Pricing and availability are subject to change.
      </p>
    </main>
  );
}
