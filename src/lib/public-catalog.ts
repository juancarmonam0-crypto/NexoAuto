import type { PrismaClient } from "@/generated/prisma";
import { Prisma } from "@/generated/prisma";
import { prisma as defaultClient } from "@/lib/db";

/**
 * The PUBLIC catalog read boundary.
 *
 * This module is the ONLY way the application reads inventory for anonymous
 * visitors, and it reads the **approved public views** created by migration
 * 0003 — not the base tables. That distinction is the whole security model:
 * `public_vehicle_listings` projects a fixed set of columns and filters to
 * published, priced vehicles, so there is no field list to keep in sync and no
 * chance of a future column leaking by accident.
 *
 * Phase 3 already proved the views are leak-free and that `anon` cannot touch
 * the base tables. This module deliberately does not re-implement field hiding.
 *
 * WHERE THE TYPES COME FROM
 * `Prisma` cannot model a SQL view, so the projection is declared here as an
 * explicit TypeScript interface that mirrors the view definition. If the view
 * ever changes, this interface and its test must change with it.
 */

/** The exact columns of `public_vehicle_listings` (27) plus a joined availability. */
export interface PublicVehicleListing {
  id: string;
  stockNumber: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string | null;
  mileage: number;
  exteriorColor: string | null;
  interiorColor: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  fuelType: string | null;
  bodyType: string | null;
  doors: number | null;
  seats: number | null;
  titleStatus: string;
  askingPriceCents: number | null;
  description: string | null;
  features: string[];
  location: string | null;
  status: string;
  dateListed: Date | null;
  dataOrigin: string;
  createdAt: Date;
  updatedAt: Date;
  /** From `public_vehicle_availability`: never exposes who reserved the car. */
  availability: "AVAILABLE" | "RESERVED";
  /** First usable photo, or null. Bytes are served separately. */
  primaryPhotoUrl: string | null;
}

export interface PublicVehiclePhoto {
  id: string;
  vehicleId: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface PublicVehicleDetail extends PublicVehicleListing {
  photos: PublicVehiclePhoto[];
}

/**
 * Selecting explicitly (rather than `SELECT *`) pins the contract: adding a
 * column to the view becomes a deliberate act instead of a silent payload
 * change.
 */
const LISTING_SELECT = Prisma.raw(`
  l."id", l."stockNumber", l."vin", l."year", l."make", l."model", l."trim",
  l."mileage", l."exteriorColor", l."interiorColor", l."transmission",
  l."drivetrain", l."engine", l."fuelType", l."bodyType", l."doors", l."seats",
  l."titleStatus", l."askingPriceCents", l."description", l."features",
  l."location", l."status", l."dateListed", l."dataOrigin", l."createdAt",
  l."updatedAt",
  a."availability",
  (SELECT p."url" FROM "public_vehicle_photos" p
    WHERE p."vehicleId" = l."id"
    ORDER BY p."isPrimary" DESC, p."sortOrder" ASC LIMIT 1) AS "primaryPhotoUrl"
`);

/** The availability view is joined, never the reservations table. */
const LISTING_FROM = Prisma.raw(`
  FROM "public_vehicle_listings" l
  JOIN "public_vehicle_availability" a ON a."vehicle_id" = l."id"
`);

export interface PublicInventoryFilter {
  search?: string;
  make?: string;
  limit?: number;
  offset?: number;
}

export const PUBLIC_INVENTORY_PAGE_SIZE = 24;

/** Published inventory, newest listing first. Anonymous-safe. */
export async function listPublicInventory(
  filter: PublicInventoryFilter = {},
  client: PrismaClient = defaultClient,
): Promise<PublicVehicleListing[]> {
  const limit = Math.min(Math.max(filter.limit ?? PUBLIC_INVENTORY_PAGE_SIZE, 1), 100);
  const offset = Math.max(filter.offset ?? 0, 0);

  const conditions: Prisma.Sql[] = [];
  const search = filter.search?.trim();
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      Prisma.sql`(l."make" ILIKE ${like} OR l."model" ILIKE ${like} OR l."vin" ILIKE ${like} OR l."stockNumber" ILIKE ${like})`,
    );
  }
  if (filter.make?.trim()) {
    conditions.push(Prisma.sql`l."make" ILIKE ${filter.make.trim()}`);
  }
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

  return client.$queryRaw<PublicVehicleListing[]>(Prisma.sql`
    SELECT ${LISTING_SELECT} ${LISTING_FROM} ${where}
    ORDER BY l."dateListed" DESC NULLS LAST, l."createdAt" DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
}

/**
 * One published vehicle with its photos, or null.
 *
 * Returning null (rather than an error) is deliberate: "this car is not for
 * sale or does not exist" is the same answer to a public visitor, and it keeps
 * sold or unlisted inventory indistinguishable from a wrong URL.
 */
export async function getPublicVehicle(
  vehicleId: string,
  client: PrismaClient = defaultClient,
): Promise<PublicVehicleDetail | null> {
  if (!vehicleId || vehicleId.length > 64) return null;

  const rows = await client.$queryRaw<PublicVehicleListing[]>(Prisma.sql`
    SELECT ${LISTING_SELECT} ${LISTING_FROM}
    WHERE l."id" = ${vehicleId}
    LIMIT 1
  `);
  const listing = rows[0];
  if (!listing) return null;

  const photos = await client.$queryRaw<PublicVehiclePhoto[]>(Prisma.sql`
    SELECT "id", "vehicleId", "url", "alt", "sortOrder", "isPrimary"
    FROM "public_vehicle_photos"
    WHERE "vehicleId" = ${vehicleId}
    ORDER BY "sortOrder" ASC
  `);

  return { ...listing, photos };
}

/** The public-facing dealer identity for the storefront shell. */
export interface PublicDealerInfo {
  name: string;
  tagline: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  heroHeadline: string | null;
  heroSubtext: string | null;
  aboutText: string | null;
}

/**
 * Read-only. Deliberately NOT `getDealerSettings()`, which creates the singleton
 * on first use — an anonymous page view must never write to the database.
 */
export async function getPublicDealerInfo(
  client: PrismaClient = defaultClient,
): Promise<PublicDealerInfo | null> {
  const settings = await client.dealerSettings.findUnique({
    where: { id: "singleton" },
    select: {
      name: true,
      tagline: true,
      phone: true,
      email: true,
      addressLine1: true,
      city: true,
      state: true,
      postalCode: true,
      heroHeadline: true,
      heroSubtext: true,
      aboutText: true,
    },
  });
  return settings ?? null;
}
