import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NEXO_MARK_LOCAL, NEXO_MARK_SHA256, NEXO_MARK_SOURCE, nexoMarkUrl } from "@/app/_components/brand";

/**
 * THE OFFICIAL BRAND ASSET — the contract.
 *
 * The owner approved one specific Supabase object as the Nexo Auto mark and
 * explicitly ruled out substitutions, redraws and reinterpretations. This file
 * makes that ruling enforceable:
 *
 *   1. the shipped file is BYTE-IDENTICAL to the approved object
 *      (SHA-256 of the published asset),
 *   2. the app renders that file — never a drawn stand-in,
 *   3. no redrawn logo can creep back into the source tree,
 *   4. favicon, apple icon and social share all use the approved artwork,
 *   5. the canonical published URL is recorded so a swap is a one-commit act.
 *
 * It also documents the delivery decision: the published object stopped
 * resolving during this phase, so the approved bytes are bundled and served by
 * this app rather than hot-linked.
 */

/** SHA-256 of the approved object as published by the owner's bucket. */
const APPROVED_SHA256 = "a42c8bc65b6341df20550d1e8b9b203b88c7433bd939f7f9aa9d8fd1a7de0f5e";

const ASSET_BUCKET = "Nexo auto imagenes";
const ASSET_FILE = "85ea2b4f-556e-4a9e-926d-721fd2328e78.png";

const repoRoot = join(__dirname, "..");
const storedAsset = join(repoRoot, "public", "brand", ASSET_FILE);

const brandSource = readFileSync(join(repoRoot, "src/app/_components/brand.tsx"), "utf8");
const layoutSource = readFileSync(join(repoRoot, "src/app/layout.tsx"), "utf8");

describe("BRAND ASSET — the approved artwork is the only mark", () => {
  it("ships the approved file byte-identical to the published object", () => {
    expect(existsSync(storedAsset), `missing approved asset at public/brand/${ASSET_FILE}`).toBe(true);

    const bytes = readFileSync(storedAsset);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(APPROVED_SHA256);
  });

  it("records the same hash in the app, so a swap cannot drift silently", () => {
    expect(NEXO_MARK_SHA256).toBe(APPROVED_SHA256);
    expect(brandSource).toContain(APPROVED_SHA256);
  });

  it("keeps the original at full resolution (not a downscaled copy)", () => {
    // The approved object is ~1.03 MB at 1254x1254. A much smaller file would
    // mean someone replaced it with a re-export.
    const { size } = statSync(storedAsset);
    expect(size).toBeGreaterThan(900_000);
    expect(size).toBeLessThan(1_200_000);
  });

  it("serves the approved bytes from this app rather than hot-linking", () => {
    // The published object answers 404 NoSuchKey; a header logo or favicon that
    // 404s is worse than a large one, so the file ships with the repository.
    expect(NEXO_MARK_LOCAL).toBe(`/brand/${ASSET_FILE}`);
    expect(nexoMarkUrl()).toBe(NEXO_MARK_LOCAL);
    // Any rendered size still resolves to the same approved artwork.
    expect(nexoMarkUrl(16)).toBe(NEXO_MARK_LOCAL);
    expect(nexoMarkUrl(400)).toBe(NEXO_MARK_LOCAL);
  });

  it("keeps the canonical published URL on record", () => {
    expect(NEXO_MARK_SOURCE).toBe(
      `https://wydsorvcpwuqqfzvnokg.supabase.co/storage/v1/object/public/${encodeURIComponent(
        ASSET_BUCKET,
      )}/${ASSET_FILE}`,
    );
  });

  it("never renders the drawn stand-in that preceded the asset", () => {
    for (const [file, source] of [
      ["brand.tsx", brandSource],
      ["layout.tsx", layoutSource],
    ] as const) {
      expect(source, `${file} must not contain a redrawn mark`).not.toContain("nexo-mark-gradient");
      expect(source, `${file} must not fall back to a drawn glyph`).not.toMatch(/<svg[\s\S]*viewBox="0 0 32 32"/);
    }
  });

  it("removed the placeholder icon that the approved asset replaced", () => {
    expect(existsSync(join(repoRoot, "public/icon.svg"))).toBe(false);
  });

  it("renders the mark as an image element loading the approved file", () => {
    expect(brandSource).toMatch(/<img[\s\S]*src=\{nexoMarkUrl\(size\)\}/);
    // Above the fold: the header mark must not wait behind lazy loading.
    expect(brandSource).toContain('loading="eager"');
    // Intrinsic box, so the 1 MB download cannot shift the header on arrival.
    expect(brandSource).toMatch(/width=\{rendered\}[\s\S]*height=\{rendered\}/);
  });

  it("uses the approved artwork for favicon, app icon and social share", () => {
    expect(layoutSource).toMatch(/icons:\s*\{[\s\S]*nexoMarkUrl\(\)/);
    expect(layoutSource).toMatch(/apple:\s*\[\{ url: nexoMarkUrl\(\)/);
    expect(layoutSource).toMatch(/openGraph:[\s\S]*images:\s*\[\{ url: nexoMarkUrl\(\)/);
    expect(layoutSource).toMatch(/twitter:[\s\S]*images: \[nexoMarkUrl\(\)\]/);
  });

  it("gives the mark a white plate on navy surfaces instead of a recolour", () => {
    // On the navy hero/footer the approved white surround is preserved; the
    // artwork itself is never recoloured or inverted.
    expect(brandSource).toContain('tone === "dark"');
    expect(brandSource).toContain("bg-white");
    expect(brandSource).not.toMatch(/invert|brightness-0|hue-rotate/);
  });
});
