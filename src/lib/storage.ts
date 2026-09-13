import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File upload validation and storage.
 *
 * SECURITY CONTROLS (all server-side):
 *   1. Size ceiling enforced before the bytes reach storage.
 *   2. Content sniffing by magic bytes. A file renamed to .jpg that is actually
 *      an HTML document or a script is rejected — the browser-supplied MIME
 *      type is never trusted.
 *   3. Extension allow-list, and the stored name is generated, never taken from
 *      the upload. Path traversal (`../`) is therefore impossible.
 *   4. SVG is rejected outright: it can carry script and this is a public site.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB per photo
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB per PDF

export type DetectedFileType = "jpeg" | "png" | "webp" | "pdf";

const SIGNATURES: Array<{ type: DetectedFileType; mime: string; extension: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    type: "jpeg",
    mime: "image/jpeg",
    extension: "jpg",
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "png",
    mime: "image/png",
    extension: "png",
    matches: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    type: "webp",
    mime: "image/webp",
    extension: "webp",
    matches: (b) =>
      b.length > 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    type: "pdf",
    mime: "application/pdf",
    extension: "pdf",
    matches: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  },
];

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface UploadValidationInput {
  fileName: string;
  declaredMimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  kind: "image" | "document";
}

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
  detectedType?: DetectedFileType;
  detectedMimeType?: string;
  safeExtension?: string;
}

/** Sniffs the real content type. Ignores the declared MIME entirely for the decision. */
export function detectFileType(bytes: Uint8Array): { type: DetectedFileType; mime: string; extension: string } | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) {
      return { type: signature.type, mime: signature.mime, extension: signature.extension };
    }
  }
  return null;
}

function looksLikeHeicOrHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = String.fromCharCode(...bytes.slice(4, 8));
  if (box !== "ftyp") return false;
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
}

export function validateUpload(input: UploadValidationInput): UploadValidationResult {
  const limit = input.kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (input.sizeBytes <= 0) return { ok: false, error: "The file is empty." };
  if (input.sizeBytes > limit) {
    return { ok: false, error: `Files must be ${Math.floor(limit / (1024 * 1024))} MB or smaller.` };
  }
  if (input.bytes.length === 0) return { ok: false, error: "The file could not be read." };

  const detected = detectFileType(input.bytes);
  if (!detected) {
    if (input.kind === "image" && looksLikeHeicOrHeif(input.bytes)) {
      return {
        ok: false,
        error: "HEIC/HEIF photos are not supported yet. Export or share the photo as JPEG, PNG, or WebP and try again.",
      };
    }
    return { ok: false, error: "Unsupported file. Upload a JPEG, PNG, WebP image or a PDF." };
  }
  if (input.kind === "image" && detected.type === "pdf") {
    return { ok: false, error: "Documents belong in the document section. Upload an image for photos." };
  }
  if (input.kind === "document" && detected.type !== "pdf") {
    return { ok: false, error: "Upload documents as PDF." };
  }

  return {
    ok: true,
    detectedType: detected.type,
    detectedMimeType: detected.mime,
    safeExtension: detected.extension,
  };
}

/**
 * Generates a storage key. The uploaded name is discarded, which removes any
 * possibility of path traversal or of an attacker choosing the on-disk name.
 */
export function buildStorageKey(options: {
  scope: "vehicle" | "document" | "trade-in";
  ownerId: string;
  extension: string;
}): string {
  const safeOwner = options.ownerId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${options.scope}/${safeOwner}/${randomUUID()}.${options.extension}`;
}

/** Strips directories and control characters for display only. */
export function sanitizeDisplayFileName(fileName: string, maxLength = 120): string {
  const base = fileName.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return cleaned.slice(0, maxLength) || "file";
}

export interface StoredFile {
  key: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
}

const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), "var", "uploads");
const DEFAULT_SUPABASE_STORAGE_BUCKET = "Nexo auto imagenes";

function encodeStoragePath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function saveToSupabaseStorage(options: {
  key: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<StoredFile> {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase object storage is not configured.");
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_SUPABASE_STORAGE_BUCKET;
  const bucketPath = encodeURIComponent(bucket);
  const objectPath = encodeStoragePath(options.key);
  const uploadBody = new Uint8Array(options.bytes).buffer;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucketPath}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": options.mimeType,
      "x-upsert": "false",
    },
    body: uploadBody,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase Storage upload failed (${response.status}): ${detail || response.statusText}`);
  }

  return {
    key: options.key,
    url: `${supabaseUrl}/storage/v1/object/public/${bucketPath}/${objectPath}`,
    sizeBytes: options.bytes.byteLength,
    mimeType: options.mimeType,
  };
}

async function saveToLocalStorage(options: {
  key: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<StoredFile> {
  const target = path.join(LOCAL_UPLOAD_ROOT, options.key);
  const resolvedRoot = path.resolve(LOCAL_UPLOAD_ROOT);
  if (!path.resolve(target).startsWith(resolvedRoot)) {
    throw new Error("Refusing to write outside the upload directory.");
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, options.bytes);

  return {
    key: options.key,
    url: `/api/files/${options.key}`,
    sizeBytes: options.bytes.byteLength,
    mimeType: options.mimeType,
  };
}

/**
 * Stores validated bytes in Supabase Storage whenever the production object
 * storage credentials are available. Local disk is a development-only fallback:
 * Vercel's filesystem is ephemeral and must never be treated as durable storage.
 */
export async function saveUploadedFile(options: {
  key: string;
  bytes: Uint8Array;
}): Promise<StoredFile> {
  const safeKey = options.key.replace(/\\/g, "/").replace(/\.\./g, "");
  const mimeType = detectFileType(options.bytes)?.mime ?? "application/octet-stream";

  if (isObjectStorageConfigured()) {
    return saveToSupabaseStorage({ key: safeKey, bytes: options.bytes, mimeType });
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Photo storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for production uploads.",
    );
  }

  return saveToLocalStorage({ key: safeKey, bytes: options.bytes, mimeType });
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export { LOCAL_UPLOAD_ROOT };
