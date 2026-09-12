import {
  type ProviderAvailability,
  type ProviderResult,
  type VinDecodeProvider,
  type VinDecodeResult,
  providerUnavailable,
} from "./types";

/**
 * VIN decoding via the NHTSA vPIC service.
 *
 * vPIC is a real, free, public US government API (no key, no scraping, no
 * CAPTCHA). It is used ONLY when a staff member explicitly asks to decode a
 * VIN while adding a vehicle — never in a loop, never on page load.
 *
 * Reference: https://vpic.nhtsa.dot.gov/api/  (DecodeVinValues)
 */

const VPIC_ENDPOINT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const REQUEST_TIMEOUT_MS = 8_000;

interface VpicResultRow {
  Make?: string;
  Model?: string;
  ModelYear?: string;
  Trim?: string;
  Series?: string;
  DisplacementL?: string;
  EngineCylinders?: string;
  EngineConfiguration?: string;
  FuelTypePrimary?: string;
  TransmissionStyle?: string;
  DriveType?: string;
  BodyClass?: string;
  Doors?: string;
  Seats?: string;
  Manufacturer?: string;
  ErrorCode?: string;
  ErrorText?: string;
}

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0" || trimmed === "Not Applicable") return undefined;
  return trimmed;
}

function toInteger(value: string | undefined): number | undefined {
  const cleaned = clean(value);
  if (cleaned === undefined) return undefined;
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildEngineDescription(row: VpicResultRow): string | undefined {
  const displacement = clean(row.DisplacementL);
  const cylinders = clean(row.EngineCylinders);
  const configuration = clean(row.EngineConfiguration);
  const parts: string[] = [];
  if (displacement) parts.push(`${displacement}L`);
  if (configuration) parts.push(configuration);
  if (cylinders) parts.push(`${cylinders}-cyl`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function normalizeVin(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/** VINs exclude I, O and Q. Enforced before we ever call the provider. */
export function isValidVinShape(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin);
}

export class NhtsaVinDecodeProvider implements VinDecodeProvider {
  readonly name = "nhtsa-vpic";

  availability(): ProviderAvailability {
    if (process.env.VIN_DECODE_DISABLED === "true") {
      return { status: "unavailable", reason: "VIN decoding disabled by configuration." };
    }
    return { status: "available", provider: this.name };
  }

  async decode(vin: string): Promise<ProviderResult<VinDecodeResult>> {
    const availability = this.availability();
    if (availability.status === "unavailable") {
      return providerUnavailable(this.name, availability.reason);
    }

    const normalized = normalizeVin(vin);
    if (!isValidVinShape(normalized)) {
      return {
        status: "error",
        provider: this.name,
        message: "That does not look like a valid VIN (17 characters, no I, O or Q).",
      };
    }

    try {
      const response = await fetch(`${VPIC_ENDPOINT}/${encodeURIComponent(normalized)}?format=json`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });

      if (!response.ok) {
        return {
          status: "error",
          provider: this.name,
          message: `The VIN decoder responded with HTTP ${response.status}.`,
        };
      }

      const payload = (await response.json()) as { Results?: VpicResultRow[] };
      const row = payload.Results?.[0];
      if (!row) {
        return { status: "error", provider: this.name, message: "The VIN decoder returned no data." };
      }

      const errorCode = clean(row.ErrorCode);
      const errorText = clean(row.ErrorText);
      if (errorCode && errorCode !== "0") {
        return {
          status: "error",
          provider: this.name,
          message: errorText ? `VIN decoder: ${errorText}` : "The VIN could not be decoded.",
        };
      }

      const result: VinDecodeResult = {
        vin: normalized,
        year: toInteger(row.ModelYear),
        make: clean(row.Make),
        model: clean(row.Model),
        trim: clean(row.Trim) ?? clean(row.Series),
        engine: buildEngineDescription(row),
        fuelType: clean(row.FuelTypePrimary),
        transmission: clean(row.TransmissionStyle),
        drivetrain: clean(row.DriveType),
        bodyType: clean(row.BodyClass),
        doors: toInteger(row.Doors),
        seats: toInteger(row.Seats),
        manufacturer: clean(row.Manufacturer),
        missingFields: [],
      };

      result.missingFields = (["year", "make", "model", "trim", "engine", "fuelType", "transmission", "drivetrain", "bodyType"] as const).filter(
        (field) => result[field] === undefined,
      );

      return { status: "ok", provider: this.name, data: result };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "The VIN decoder timed out. Enter the vehicle details manually."
          : "The VIN decoder is unreachable. Enter the vehicle details manually.";
      return { status: "error", provider: this.name, message };
    }
  }
}

export const vinDecodeProvider: VinDecodeProvider = new NhtsaVinDecodeProvider();
