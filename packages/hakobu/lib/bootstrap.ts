/**
 * Hakobu Runtime Bootstrap
 *
 * Initializes the snapshot filesystem and loads the packaged entrypoint.
 *
 * Startup sequence:
 *   1. Mount the snapshot FS (patch Node's fs module)
 *   2. Determine entry format (ESM or CJS)
 *   3. For ESM: register loader hooks via module.register(), then import()
 *   4. For CJS: require() the entry directly
 */

import { register } from 'node:module';
import Module from 'node:module';
import { pathToFileURL } from 'node:url';

import type { SnapshotFS } from './snapshot-fs';
import type { SnapshotIndex } from './snapshot-index';
import { patchFS } from './snapshot-fs-patch';
import { toFileUrl, toNative } from './snapshot-path';
import { getHookSource } from './esm-hooks';
import type { HookTransferData } from './esm-hooks';
import type { ModuleFormat } from './manifest';

// ─────────────────────────────────────────────────────────────────────
// Bootstrap result
// ─────────────────────────────────────────────────────────────────────

export interface BootstrapResult {
  mode: 'esm' | 'cjs';
  entrypoint: string;
  entryUrl: string | null;
  unpatch: () => void;
}

// ─────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────

export async function bootstrap(
  sfs: SnapshotFS,
  options?: {
    entry?: string;
    dryRun?: boolean;
  },
): Promise<BootstrapResult> {
  const unpatch = patchFS(sfs);

  const entrySnapshotPath = options?.entry ?? sfs.getEntrypoint();
  const format = sfs.getModuleFormat(entrySnapshotPath) ?? sfs.getEntrypointFormat();

  if (format === 'esm') {
    return bootstrapESM(sfs, entrySnapshotPath, unpatch, options?.dryRun ?? false);
  } else {
    return bootstrapCJS(sfs, entrySnapshotPath, unpatch, options?.dryRun ?? false);
  }
}

// ─────────────────────────────────────────────────────────────────────
// ESM bootstrap — registers real loader hooks
// ─────────────────────────────────────────────────────────────────────

async function bootstrapESM(
  sfs: SnapshotFS,
  entrySnapshotPath: string,
  unpatch: () => void,
  dryRun: boolean,
): Promise<BootstrapResult> {
  const entryUrl = toFileUrl(entrySnapshotPath);

  if (!dryRun) {
    // Build the transfer data for the loader hooks
    const transferData = buildHookTransferData(sfs);

    // Register the ESM loader hooks via data: URL.
    // The hooks run in Node's loader thread and receive the snapshot
    // data via initialize(). They handle resolve + load for all
    // snapshot-owned modules.
    const hookSource = getHookSource();
    const hookUrl = `data:text/javascript,${encodeURIComponent(hookSource)}`;

    register(hookUrl, {
      parentURL: pathToFileURL(__filename).href,
      data: transferData,
      transferList: [transferData.blob],
    });

    // Pre-cache all CJS modules from the snapshot in Node's module
    // cache. This is needed because Node 24's CJS translator creates
    // its own require() that doesn't go through the hooks for nested
    // CJS requires. By pre-caching, require() finds the module in
    // cache and skips the file-existence validation.
    preloadCJSModules(sfs);

    // Now import the entry. The registered hooks will handle
    // resolution and loading for ESM snapshot modules.
    //
    // Use Function constructor to get the real import() that goes
    // through the ESM loader, not TypeScript's CJS-compiled require().
    const dynamicImport = new Function('url', 'return import(url)');
    await dynamicImport(entryUrl);
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
  sfs: SnapshotFS,
  entrySnapshotPath: string,
  unpatch: () => void,
  dryRun: boolean,
): Promise<BootstrapResult> {
  const nativePath = toNative(entrySnapshotPath);

  if (!dryRun) {
    // CJS entry is loaded directly via require(). The patched
    // Module._resolveFilename + Module._compile handle snapshot
    // resolution and source loading. No preloading needed.
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
// Hook data builder
// ─────────────────────────────────────────────────────────────────────

function buildHookTransferData(sfs: SnapshotFS): HookTransferData {
  const index = (sfs as any).index as SnapshotIndex;

  // Build entries map: path → { offset, size, format }
  const entries: Record<string, { offset: number; size: number; format: string | null }> = {};
  for (const entry of index.entries) {
    entries[entry.path] = {
      offset: entry.offset,
      size: entry.size,
      format: entry.format,
    };
  }

  // Build packages map: path → { type, main, directory }
  const packages: Record<string, { type: string | null; main: string | null; directory: string }> = {};
  for (const [path, pkg] of Object.entries(index.packages)) {
    packages[path] = {
      type: pkg.type,
      main: pkg.main,
      directory: pkg.directory,
    };
  }

  // Get directory paths for existence checks
  const directories = Object.keys(index.directories);

  // Copy the blob to a transferable ArrayBuffer
  const blob = (sfs as any).blob as Buffer;
  const blobCopy = new ArrayBuffer(blob.length);
  new Uint8Array(blobCopy).set(blob);

  return {
    entries,
    packages,
    blob: blobCopy,
    appId: index.appId,
    directories,
  };
}

// ─────────────────────────────────────────────────────────────────────
// CJS preloading
// ─────────────────────────────────────────────────────────────────────

/**
 * Pre-populate Node's CJS module cache for JSON/package.json files in
 * the snapshot. CJS scripts are NOT preloaded — they're loaded lazily
 * when require() is called, using the _resolveFilename + _compile
 * patches on the main thread.
 *
 * JSON files are preloaded eagerly because they have no side effects
 * and are frequently needed for package resolution.
 */
function preloadCJSModules(sfs: SnapshotFS) {
  const index = (sfs as any).index as SnapshotIndex;

  for (const entry of index.entries) {
    // Only preload JSON files eagerly (no side effects)
    if (entry.kind !== 'json' && entry.kind !== 'package-json') continue;

    const filename = toNative(entry.path);
    if ((Module as any)._cache[filename]) continue;

    try {
      const content = sfs.readFileSync(entry.path).toString('utf8');
      const mod = new (Module as any)(filename, null);
      mod.filename = filename;
      mod.exports = JSON.parse(content);
      mod.loaded = true;
      (Module as any)._cache[filename] = mod;
    } catch {
      // Skip invalid JSON
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostics
// ─────────────────────────────────────────────────────────────────────

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
