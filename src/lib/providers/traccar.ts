import {
  type GpsProvider,
  type ProviderAvailability,
  type ProviderResult,
  type TrackerDevice,
  type TrackerPosition,
  providerUnavailable,
} from "./types";

/**
 * Optional Traccar GPS integration.
 *
 * Traccar (Apache-2.0) exposes a REST API on port 8082 by default. Auth is a
 * bearer token or HTTP Basic against /api/session.
 *
 * HONEST STATUS: this adapter is architecture, not a verified deployment. It is
 * disabled unless TRACCAR_BASE_URL and TRACCAR_API_TOKEN are set, and the
 * resource paths are overridable by configuration because they vary between
 * Traccar versions. Verify them against the OpenAPI spec shipped with your
 * Traccar release before relying on this in production.
 *
 * SECURITY: tracker credentials and location history are server-only. They are
 * never exposed on any public page and never sent to a browser bundle.
 * GPS is never required to list, reserve or sell a vehicle.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

function config() {
  const baseUrl = process.env.TRACCAR_BASE_URL?.trim();
  const token = process.env.TRACCAR_API_TOKEN?.trim();
  return {
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : undefined,
    token,
    devicesPath: process.env.TRACCAR_DEVICES_PATH?.trim() || "/api/devices",
    positionsPath: process.env.TRACCAR_POSITIONS_PATH?.trim() || "/api/positions",
    eventsPath: process.env.TRACCAR_EVENTS_PATH?.trim() || "/api/reports/events",
  };
}

export interface TraccarGeofenceEvent {
  deviceId: string;
  type: string;
  geofenceId?: string;
  eventTime: Date;
}

export class TraccarGpsProvider implements GpsProvider {
  readonly name = "traccar";

  availability(): ProviderAvailability {
    const { baseUrl, token } = config();
    if (!baseUrl || !token) {
      return {
        status: "unavailable",
        reason: "Set TRACCAR_BASE_URL and TRACCAR_API_TOKEN to enable GPS tracking.",
      };
    }
    return { status: "available", provider: this.name };
  }

  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<ProviderResult<T>> {
    const availability = this.availability();
    if (availability.status === "unavailable") return providerUnavailable(this.name, availability.reason);

    const { baseUrl, token } = config();
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) {
        return {
          status: "error",
          provider: this.name,
          message: `Traccar responded with HTTP ${response.status}.`,
        };
      }
      return { status: "ok", provider: this.name, data: (await response.json()) as T };
    } catch {
      return { status: "error", provider: this.name, message: "Traccar is unreachable." };
    }
  }

  async listDevices(): Promise<ProviderResult<TrackerDevice[]>> {
    const { devicesPath } = config();
    const result = await this.request<Array<{ id: number; name: string; status?: string; lastUpdate?: string | null }>>(
      devicesPath,
    );
    if (result.status !== "ok") {
      return { status: result.status, provider: this.name, message: result.message };
    }
    if (!result.data) {
      return { status: "error", provider: this.name, message: "Traccar returned no devices." };
    }

    const now = Date.now();
    const devices: TrackerDevice[] = result.data.map((device) => {
      const lastUpdate = device.lastUpdate ? new Date(device.lastUpdate) : undefined;
      const fresh = lastUpdate ? now - lastUpdate.getTime() < 15 * 60_000 : false;
      return {
        deviceId: String(device.id),
        name: device.name,
        status: device.status === "online" || fresh ? "online" : device.status === "offline" ? "offline" : "unknown",
        lastUpdate,
      };
    });
    return { status: "ok", provider: this.name, data: devices };
  }

  async getLatestPosition(deviceId: string): Promise<ProviderResult<TrackerPosition>> {
    const { positionsPath } = config();
    const result = await this.request<Array<{ deviceId: number; latitude: number; longitude: number; speed?: number; course?: number; fixTime?: string; valid?: boolean }>>(
      positionsPath,
      { deviceId },
    );
    if (result.status !== "ok" || !result.data || result.data.length === 0) {
      return {
        status: result.status === "ok" ? "unavailable" : result.status,
        provider: this.name,
        message: result.status === "ok" ? "No position has been reported for this device." : result.message,
      };
    }
    const latest = result.data[0]!;
    return {
      status: "ok",
      provider: this.name,
      data: {
        deviceId: String(latest.deviceId),
        latitude: latest.latitude,
        longitude: latest.longitude,
        speedKnots: latest.speed,
        courseDegrees: latest.course,
        fixTime: latest.fixTime ? new Date(latest.fixTime) : new Date(),
        valid: latest.valid ?? true,
      },
    };
  }

  async listGeofenceEvents(deviceId: string, from: Date, to: Date): Promise<ProviderResult<TraccarGeofenceEvent[]>> {
    const { eventsPath } = config();
    const result = await this.request<Array<{ deviceId: number; type: string; geofenceId?: number; eventTime: string }>>(
      eventsPath,
      { deviceId, from: from.toISOString(), to: to.toISOString(), type: "geofenceEnter,geofenceExit" },
    );
    if (result.status !== "ok") {
      return { status: result.status, provider: this.name, message: result.message };
    }
    if (!result.data) {
      return { status: "error", provider: this.name, message: "Traccar returned no events." };
    }
    return {
      status: "ok",
      provider: this.name,
      data: result.data.map((event) => ({
        deviceId: String(event.deviceId),
        type: event.type,
        geofenceId: event.geofenceId === undefined ? undefined : String(event.geofenceId),
        eventTime: new Date(event.eventTime),
      })),
    };
  }
}

export const gpsProvider: GpsProvider = new TraccarGpsProvider();
