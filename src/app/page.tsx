import Link from "next/link";
import { formatCents } from "@/lib/money";
import { getPublicDealerInfo, listPublicInventory } from "@/lib/public-catalog";

/**
 * Public storefront home.
 *
 * Reads ONLY the approved public surface (`src/lib/public-catalog.ts`): dealer
 * identity plus published inventory. Anonymous, so it must never touch the
 * operator boundary.
 */

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [dealer, featured] = await Promise.all([
    getPublicDealerInfo(),
    listPublicInventory({ limit: 6 }),
  ]);

  const name = dealer?.name ?? "Nexo Auto";

  return (
    <main>
      <header>
        <h1>{dealer?.heroHeadline?.trim() || name}</h1>
        <p className="muted">{dealer?.heroSubtext?.trim() || dealer?.tagline || "Used vehicles, honestly priced."}</p>
      </header>

      <p>
        <Link href="/inventory">Browse inventory</Link>
        {" · "}
        <Link href="/admin/login">Operator sign in</Link>
      </p>

      <h2>Available now</h2>
      {featured.length === 0 ? (
        <p className="muted">No vehicles are published at the moment.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Mileage</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {featured.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                  {vehicle.trim ? ` ${vehicle.trim}` : ""}
                </td>
                <td>{vehicle.mileage.toLocaleString("en-US")} mi</td>
                <td>{formatCents(vehicle.askingPriceCents)}</td>
                <td>
                  <Link href={`/inventory/${vehicle.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dealer?.aboutText ? (
        <>
          <h2>About</h2>
          <p>{dealer.aboutText}</p>
        </>
      ) : null}

      {dealer?.phone || dealer?.email ? (
        <p className="muted">
          {dealer?.phone ? `Phone ${dealer.phone}` : null}
          {dealer?.phone && dealer?.email ? " · " : null}
          {dealer?.email ? `Email ${dealer.email}` : null}
        </p>
      ) : null}
    </main>
  );
}
