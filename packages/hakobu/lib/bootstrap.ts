/**
 * Hakobu Runtime Bootstrap
 *
 * Initializes the snapshot filesystem and loads the packaged entrypoint.
 * This is the first user-visible code that runs in the packaged executable.
 *
 * Startup sequence:
 *   1. Deserialize the snapshot index
 *   2. Mount the snapshot FS (patch Node's fs module)
 *   3. Determine entry format (ESM or CJS)
 *   4. Load the entry:
 *      - ESM: register loader hooks via module.register(), then import()
 *      - CJS: require() the entry directly
 *
 * This module is designed to be called from the patched binary's
 * bootstrap script. It receives the pre-built SnapshotFS instance.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { SnapshotFS } from './snapshot-fs';
import { patchFS } from './snapshot-fs-patch';
import { toFileUrl, toNative } from './snapshot-path';
import type { ModuleFormat } from './manifest';

// ─────────────────────────────────────────────────────────────────────
// Bootstrap result
// ─────────────────────────────────────────────────────────────────────

export interface BootstrapResult {
  /** How the entry was loaded. */
  mode: 'esm' | 'cjs';

  /** The canonical snapshot path of the entrypoint. */
  entrypoint: string;

  /** The file: URL used for ESM loading (null for CJS). */
  entryUrl: string | null;

  /** Function to restore the original fs (for testing). */
  unpatch: () => void;
}

// ─────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the Hakobu runtime and load the packaged entrypoint.
 *
 * @param sfs - The pre-initialized SnapshotFS instance
 * @param options - Bootstrap options
 * @returns BootstrapResult describing what was loaded
 */
export async function bootstrap(
  sfs: SnapshotFS,
  options?: {
    /** Override the entrypoint (for testing). */
    entry?: string;
    /** Skip actually loading the entry (for testing). */
    dryRun?: boolean;
  },
): Promise<BootstrapResult> {
  // ── 1. Mount the snapshot filesystem ──
  const unpatch = patchFS(sfs);

  // ── 2. Determine entrypoint and format ──
  const entrySnapshotPath = options?.entry ?? sfs.getEntrypoint();
  const format = sfs.getModuleFormat(entrySnapshotPath) ?? sfs.getEntrypointFormat();

  // ── 3. Load the entry ──
  if (format === 'esm') {
    return bootstrapESM(sfs, entrySnapshotPath, unpatch, options?.dryRun ?? false);
  } else {
    return bootstrapCJS(entrySnapshotPath, unpatch, options?.dryRun ?? false);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ESM bootstrap
// ─────────────────────────────────────────────────────────────────────

async function bootstrapESM(
  sfs: SnapshotFS,
  entrySnapshotPath: string,
  unpatch: () => void,
  dryRun: boolean,
): Promise<BootstrapResult> {
  // Convert snapshot path to file: URL for ESM loading.
  // Node's ESM loader uses file: URLs as module identifiers.
  const entryUrl = toFileUrl(entrySnapshotPath);

  if (!dryRun) {
    // The snapshot FS is already patched, so Node's fs.readFileSync
    // will serve the entry's content from the blob. The ESM loader
    // reads source via fs and the format is determined by the
    // snapshot index (pre-resolved at packaging time).
    //
    // For Task 6.2, module.register() will install custom resolve/load
    // hooks here. For now, the fs patch is sufficient for loading the
    // entry if Node can find it via the patched fs.
    await import(entryUrl);
  }

  return {
    mode: 'esm',
    entrypoint: entrySnapshotPath,
    entryUrl,
    unpatch,
  };
}

// ─────────────────────────────────────────────────────────────────────
// CJS bootstrap
// ─────────────────────────────────────────────────────────────────────

async function bootstrapCJS(
  entrySnapshotPath: string,
  unpatch: () => void,
  dryRun: boolean,
): Promise<BootstrapResult> {
  // Convert snapshot path to platform-native path for require().
  const nativePath = toNative(entrySnapshotPath);

  if (!dryRun) {
    // The snapshot FS is already patched, so require() will read
    // the entry's content from the blob via the patched fs.readFileSync.
    require(nativePath);
  }

  return {
    mode: 'cjs',
    entrypoint: entrySnapshotPath,
    entryUrl: null,
    unpatch,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Entry format determination (standalone, for diagnostics)
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine the bootstrap mode for a given SnapshotFS.
 * Useful for diagnostics without actually loading the entry.
 */
export function determineBootstrapMode(sfs: SnapshotFS): {
  entrypoint: string;
  format: ModuleFormat;
  entryUrl: string;
  nativePath: string;
} {
  const entrypoint = sfs.getEntrypoint();
  const format = sfs.getEntrypointFormat();
  const entryUrl = toFileUrl(entrypoint);
  const nativePath = toNative(entrypoint);

  return { entrypoint, format, entryUrl, nativePath };
}
