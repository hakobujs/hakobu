/**
 * Windows PE Metadata Injection
 *
 * Injects VERSIONINFO resources and optionally an application icon
 * into Windows PE executables (.exe) using resedit.
 *
 * This runs after packaging but before Authenticode signing (signing
 * must be the last step since it covers the entire file).
 *
 * Environment: resedit is a pure-JS PE resource editor that works
 * cross-platform — metadata can be injected from macOS/Linux too.
 */

import fs from 'fs';

import { log } from './log';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface ExeMetadata {
  /** Product name shown in file properties (e.g., "My App"). */
  productName?: string;

  /** File description shown in Task Manager and file properties. */
  fileDescription?: string;

  /** Company / publisher name. */
  companyName?: string;

  /** Legal copyright string (e.g., "Copyright 2026 ACME Corp"). */
  legalCopyright?: string;

  /**
   * File version (e.g., "1.2.3" or "1.2.3.4").
   * Dot-separated, up to 4 parts. Missing parts default to 0.
   */
  fileVersion?: string;

  /**
   * Product version (e.g., "1.2.3").
   * Defaults to fileVersion if not specified.
   */
  productVersion?: string;

  /**
   * Path to a .ico file to embed as the application icon.
   * Must be a valid Windows ICO file (not PNG/SVG).
   */
  icon?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Version parsing
// ─────────────────────────────────────────────────────────────────────

function parseVersionQuad(v: string): [number, number, number, number] {
  const parts = v.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
}

// ─────────────────────────────────────────────────────────────────────
// Injection
// ─────────────────────────────────────────────────────────────────────

/**
 * Inject metadata into a Windows PE executable.
 *
 * Modifies the file in-place. Must be called BEFORE Authenticode
 * signing (signing covers the entire file including resources).
 *
 * Uses dynamic import for resedit (ESM-only in v3). If resedit is
 * not installed, throws a clear error.
 */
export async function injectPeMetadata(
  exePath: string,
  metadata: ExeMetadata,
): Promise<void> {
  // Load resedit dynamically (ESM package with CJS shim)
  let resedit: any;
  try {
    const cjsEntry = require.resolve('resedit/cjs');
    const { load } = require(cjsEntry);
    resedit = await load();
  } catch {
    throw new Error(
      'Cannot inject PE metadata: resedit is not installed.\n' +
        'Install it with: pnpm add resedit\n' +
        'resedit is a pure-JS PE resource editor that works cross-platform.',
    );
  }

  const { NtExecutable, NtExecutableResource, Resource, Data } = resedit;

  // Read the executable
  const exeData = fs.readFileSync(exePath);
  const exe = NtExecutable.from(exeData);
  const res = NtExecutableResource.from(exe);

  // ── Version info ──
  if (
    metadata.fileVersion ||
    metadata.productVersion ||
    metadata.productName ||
    metadata.fileDescription ||
    metadata.companyName ||
    metadata.legalCopyright
  ) {
    // Get existing version info or create new
    const viList = Resource.VersionInfo.fromEntries(res.entries);
    let vi: any;

    if (viList.length > 0) {
      vi = viList[0];
    } else {
      vi = Resource.VersionInfo.createEmpty();
    }

    const lang = 0x0409; // English (US)
    const codepage = 0x04b0; // Unicode

    if (metadata.fileVersion) {
      const [a, b, c, d] = parseVersionQuad(metadata.fileVersion);
      vi.setFileVersion(a, b, c, d, lang);
    }

    if (metadata.productVersion || metadata.fileVersion) {
      const ver = metadata.productVersion || metadata.fileVersion!;
      const [a, b, c, d] = parseVersionQuad(ver);
      vi.setProductVersion(a, b, c, d, lang);
    }

    const strings: Record<string, string> = {};
    if (metadata.fileDescription)
      strings.FileDescription = metadata.fileDescription;
    if (metadata.productName) strings.ProductName = metadata.productName;
    if (metadata.companyName) strings.CompanyName = metadata.companyName;
    if (metadata.legalCopyright)
      strings.LegalCopyright = metadata.legalCopyright;
    if (metadata.fileVersion) strings.FileVersion = metadata.fileVersion;
    if (metadata.productVersion || metadata.fileVersion) {
      strings.ProductVersion = metadata.productVersion || metadata.fileVersion!;
    }

    if (Object.keys(strings).length > 0) {
      vi.setStringValues({ lang, codepage }, strings);
    }

    vi.outputToResourceEntries(res.entries);
  }

  // ── Icon ──
  if (metadata.icon) {
    if (!fs.existsSync(metadata.icon)) {
      throw new Error(`Icon file not found: ${metadata.icon}`);
    }

    const iconData = fs.readFileSync(metadata.icon);
    const iconFile = Data.IconFile.from(iconData);

    // Remove existing icon groups and add new one
    Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1, // resource ID
      0x0409,
      iconFile.icons.map((icon: any) => icon.data),
    );
  }

  // Write back
  res.outputResource(exe);
  const output = exe.generate();
  fs.writeFileSync(exePath, Buffer.from(output));

  const fields = [];
  if (metadata.productName) fields.push(`product="${metadata.productName}"`);
  if (metadata.fileVersion) fields.push(`version=${metadata.fileVersion}`);
  if (metadata.icon) fields.push('icon=embedded');
  log.info(`Injected PE metadata: ${fields.join(', ')}`);
}
