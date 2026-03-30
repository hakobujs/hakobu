/**
 * Hakobu Native Addon Extraction
 *
 * Native .node addons cannot be loaded from an in-memory snapshot —
 * they must exist as real files on the filesystem because dlopen()
 * requires a real file path.
 *
 * This module extracts addons from the snapshot blob to a deterministic
 * cache location on disk, keyed by content hash. This ensures:
 *
 *   1. Deterministic: same addon content → same extraction path
 *   2. Idempotent: re-extraction is a no-op if the file already exists
 *   3. Safe: permissions are narrowed appropriately
 *   4. Cache-friendly: old versions can be garbage-collected
 *
 * Extraction path:
 *   {cacheDir}/{contentHash}/{addonFilename}
 *
 *   e.g.: ~/.hakobu/addons/a1b2c3d4.../binding.node
 *
 * The extracted path replaces the snapshot path in require() resolution
 * so that dlopen() can load the real file.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

import type { SnapshotFS } from './snapshot-fs';
import { toCanonical } from './snapshot-path';
import { addonExtractionFailed } from './runtime-diagnostics';

// ─────────────────────────────────────────────────────────────────────
// Cache directory
// ─────────────────────────────────────────────────────────────────────

/**
 * Get the addon extraction cache directory.
 *
 * Resolution order:
 *   1. HAKOBU_ADDON_CACHE env var
 *   2. $HOME/.hakobu/addons (default)
 *   3. os.tmpdir()/hakobu-addons (fallback when home unavailable)
 */
export function getAddonCacheDir(): string {
  if (process.env.HAKOBU_ADDON_CACHE) {
    return process.env.HAKOBU_ADDON_CACHE;
  }
  try {
    const home = os.homedir();
    if (home) {
      return path.join(home, '.hakobu', 'addons');
    }
  } catch {
    /* home unavailable */
  }
  return path.join(os.tmpdir(), 'hakobu-addons');
}

// ─────────────────────────────────────────────────────────────────────
// Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Result of extracting a native addon.
 */
export interface ExtractedAddon {
  /** Original snapshot path of the addon. */
  snapshotPath: string;

  /** Real filesystem path where the addon was extracted. */
  extractedPath: string;

  /** SHA-256 hash of the addon content. */
  contentHash: string;

  /** Whether the addon was freshly extracted (false = cache hit). */
  freshlyExtracted: boolean;
}

/**
 * Extract a native addon from the snapshot to the real filesystem.
 *
 * If the addon is already cached (same content hash), returns the
 * existing path without re-extracting. This makes extraction idempotent.
 *
 * @param snapshotPath - The addon's path in the snapshot
 * @param sfs - The SnapshotFS instance
 * @param cacheDir - Override cache directory (for testing)
 * @returns ExtractedAddon with the real filesystem path
 */
export function extractAddon(
  snapshotPath: string,
  sfs: SnapshotFS,
  cacheDir?: string,
): ExtractedAddon {
  const canonical = toCanonical(snapshotPath);
  const content = sfs.readFileSync(canonical);

  // Compute content hash for deterministic path
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // Build extraction path: {cacheDir}/{hash}/{filename}
  const fileName = path.basename(canonical);
  const dir = path.join(cacheDir || getAddonCacheDir(), contentHash);
  const extractedPath = path.join(dir, fileName);

  // Check cache: if file exists with correct size, skip extraction
  if (fs.existsSync(extractedPath)) {
    try {
      const stat = fs.statSync(extractedPath);
      if (stat.size === content.length) {
        return {
          snapshotPath: canonical,
          extractedPath,
          contentHash,
          freshlyExtracted: false,
        };
      }
    } catch {
      // Fall through to extract
    }
  }

  // Extract: create directory and write the addon
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(extractedPath, content);
  } catch (err: any) {
    throw addonExtractionFailed(canonical, extractedPath, err);
  }

  // Set executable permission (some addons need it)
  try {
    fs.chmodSync(extractedPath, 0o755);
  } catch {
    // chmod may fail on some platforms — non-fatal
  }

  return {
    snapshotPath: canonical,
    extractedPath,
    contentHash,
    freshlyExtracted: true,
  };
}

/**
 * Extract all native addons from the snapshot.
 * Returns a map from snapshot path → extracted filesystem path.
 */
export function extractAllAddons(
  sfs: SnapshotFS,
  cacheDir?: string,
): Map<string, ExtractedAddon> {
  const index = (sfs as any).index;
  const results = new Map<string, ExtractedAddon>();

  for (const entry of index.entries) {
    if (entry.kind === 'native-addon') {
      const result = extractAddon(entry.path, sfs, cacheDir);
      results.set(entry.path, result);
    }
  }

  return results;
}

/**
 * Clean old addon cache entries that are no longer referenced.
 * @param keepHashes - Set of content hashes to keep
 * @param cacheDir - Cache directory to clean
 */
export function cleanAddonCache(
  keepHashes: Set<string>,
  cacheDir?: string,
): number {
  const dir = cacheDir || getAddonCacheDir();
  if (!fs.existsSync(dir)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (!keepHashes.has(entry)) {
      try {
        fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        removed++;
      } catch {
        // Non-fatal
      }
    }
  }

  return removed;
}
