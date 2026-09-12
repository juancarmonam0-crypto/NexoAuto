import Link from "next/link";
import type { Metadata } from "next";
import { formatCents } from "@/lib/money";
import { PUBLIC_INVENTORY_PAGE_SIZE, listPublicInventory } from "@/lib/public-catalog";

/**
 * Public inventory list.
 *
 * Reads the approved public surface only. There is no role, no session and no
 * operator context on this route, so nothing here may reach an operation.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inventory" };

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = typeof params.q === "string" && params.q.trim() !== "" ? params.q.trim().slice(0, 80) : undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const vehicles = await listPublicInventory({
    search,
    limit: PUBLIC_INVENTORY_PAGE_SIZE,
    offset: (page - 1) * PUBLIC_INVENTORY_PAGE_SIZE,
  });

  return (
    <main>
      <p>
        <Link href="/">← Home</Link>
      </p>
      <h1>Inventory</h1>

      <form method="get" action="/inventory">
        <label>
          Search
          <input type="search" name="q" defaultValue={search ?? ""} placeholder="Make, model, VIN or stock number" />
        </label>
        <button type="submit">Search</button>
      </form>

      {vehicles.length === 0 ? (
        <p className="muted">No published vehicles match that search.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Mileage</th>
              <th>Exterior</th>
              <th>Status</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                  {vehicle.trim ? ` ${vehicle.trim}` : ""}
                  <div className="muted">Stock {vehicle.stockNumber}</div>
                </td>
                <td>{vehicle.mileage.toLocaleString("en-US")} mi</td>
                <td>{vehicle.exteriorColor ?? "—"}</td>
                <td>{vehicle.availability === "RESERVED" ? "Reserved" : "Available"}</td>
                <td>{formatCents(vehicle.askingPriceCents)}</td>
                <td>
                  <Link href={`/inventory/${vehicle.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="row">
        {page > 1 ? <Link href={`/inventory?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page - 1) })}`}>← Previous</Link> : null}
        <span className="muted">Page {page}</span>
        {vehicles.length === PUBLIC_INVENTORY_PAGE_SIZE ? (
          <Link href={`/inventory?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page + 1) })}`}>Next →</Link>
        ) : null}
      </p>
    </main>
  );
}
