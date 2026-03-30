/**
 * Hakobu Snapshot Index
 *
 * The snapshot index is the structural contract between the packaging
 * pipeline and the runtime. It describes every file in the snapshot,
 * every package boundary, and enough metadata for the runtime to:
 *
 *   - serve fs operations (readFile, stat, readdir, realpath)
 *   - determine module format per-file (ESM vs CJS)
 *   - resolve imports through package.json exports/imports maps
 *   - construct canonical file: URLs for import.meta.url
 *   - extract native addons to the real filesystem
 *
 * Invariants:
 *   1. DETERMINISTIC: identical manifest → identical index → identical blob.
 *      Entries are sorted by snapshot path (lexicographic, POSIX).
 *   2. POSIX-NORMALIZED: all paths use '/' separators and are absolute
 *      within the snapshot root (/snapshot/{appId}/...). The runtime
 *      projects these to platform-native paths at execution time.
 *   3. NO HOST PATHS: the index never contains host filesystem paths.
 *      The manifest's absolutePath is consumed during blob assembly
 *      and does not appear in the index.
 *   4. SELF-CONTAINED for resolution: the index carries enough package
 *      metadata to resolve imports without re-reading package.json
 *      from the blob. This is critical for ESM loader performance.
 *
 * Lifecycle:
 *   PackagingManifest → buildSnapshotIndex() → SnapshotIndex
 *                                                   ↓
 *                               (Task 5.2) blob assembly + fs hooks
 *                                                   ↓
 *                               (Task 6) ESM loader reads the index
 */

import type {
  PackagingManifest,
  ManifestFile,
  PackageMetadata,
  ModuleFormat,
  FileKind,
} from './manifest';

// ─────────────────────────────────────────────────────────────────────
// Snapshot entry
// ─────────────────────────────────────────────────────────────────────

/**
 * A single file entry in the snapshot.
 *
 * Each entry describes one packaged file and carries enough metadata
 * for the runtime to serve it correctly without reading the blob
 * content.
 */
export interface SnapshotEntry {
  /**
   * Canonical snapshot path (POSIX, absolute within snapshot root).
   * e.g., "/snapshot/my-app/src/index.js"
   *
   * This path is:
   * - the key for fs operations (readFile, stat)
   * - the basis for file: URL construction (import.meta.url)
   * - deterministic across platforms
   */
  path: string;

  /** File classification. */
  kind: FileKind;

  /**
   * Module format for scripts. Null for non-script entries.
   *
   * This is pre-resolved at packaging time using Node 24 rules:
   *   .mjs → 'esm', .cjs → 'cjs', .js → nearest package.json "type"
   *
   * The runtime trusts this value and does NOT re-parse package.json
   * to determine format. This is a key design decision: format is
   * a packaging-time fact, not a runtime decision.
   */
  format: ModuleFormat | null;

  /**
   * Snapshot path of the package.json that governs this file.
   * Null for files outside any package boundary.
   *
   * Used by the runtime to:
   * - look up the package's "type" field (redundant with format,
   *   but needed for Node compatibility checks)
   * - enforce exports/imports boundaries
   * - resolve bare specifiers within the package context
   */
  packageBoundary: string | null;

  /** Byte offset of this entry's content within the snapshot blob. */
  offset: number;

  /** Byte length of this entry's content in the blob. */
  size: number;

  /**
   * SHA-256 hash of the file content. Used for:
   * - native addon extraction (deterministic cache path)
   * - build reproducibility verification
   */
  contentHash: string;
}

// ─────────────────────────────────────────────────────────────────────
// Package boundary
// ─────────────────────────────────────────────────────────────────────

/**
 * A package boundary in the snapshot.
 *
 * Each boundary corresponds to a package.json and carries the
 * resolution-relevant metadata that the runtime needs. This is the
 * runtime's view of PackageMetadata — optimized for lookup, not for
 * analysis.
 *
 * The ESM loader uses this to:
 * - determine "type" for .js files within this package
 * - evaluate "exports" maps for bare specifier resolution
 * - evaluate "imports" maps for #-prefixed specifiers
 * - find "main" for legacy CJS entry resolution
 */
export interface SnapshotPackageBoundary {
  /** Snapshot path of this package.json. */
  path: string;

  /** Package name (e.g., "express"). Null for unnamed packages. */
  name: string | null;

  /** Package version. Null if absent. */
  version: string | null;

  /**
   * Package type. Determines .js format for files in this package.
   * - "module": .js files are ESM
   * - "commonjs": .js files are CJS
   * - null: no type field → Node default (CJS)
   */
  type: 'module' | 'commonjs' | null;

  /** "main" field for CJS entry resolution. */
  main: string | null;

  /**
   * "exports" map (raw JSON value from package.json).
   * The runtime evaluates this at import time to resolve subpath
   * exports with the correct conditions (import, require, default, node).
   *
   * Stored as-is because the exports map shape is complex and
   * condition-dependent. Evaluating it at packaging time would
   * require knowing the runtime conditions, which differ between
   * ESM and CJS callers.
   */
  exports: unknown | null;

  /**
   * "imports" map (raw JSON value from package.json).
   * Used to resolve #-prefixed specifiers within this package.
   */
  imports: unknown | null;

  /**
   * Snapshot path of the directory containing this package.json.
   * Derived from path by stripping "/package.json".
   * The runtime uses this for directory-relative resolution.
   */
  directory: string;
}

// ─────────────────────────────────────────────────────────────────────
// Directory entry (for readdir / stat support)
// ─────────────────────────────────────────────────────────────────────

/**
 * Pre-computed directory listing for snapshot directories.
 *
 * The runtime needs to support readdir() and stat() on directories
 * within the snapshot. Rather than scanning entries at runtime,
 * the index pre-computes the directory tree.
 */
export interface SnapshotDirectory {
  /** Snapshot path of this directory. */
  path: string;

  /** Names of files directly in this directory (not full paths). */
  files: string[];

  /** Names of subdirectories directly in this directory. */
  directories: string[];
}

// ─────────────────────────────────────────────────────────────────────
// The snapshot index
// ─────────────────────────────────────────────────────────────────────

/**
 * The Hakobu Snapshot Index.
 *
 * This is the complete structural description of a packaged snapshot.
 * It is produced from a PackagingManifest and consumed by:
 * - the blob assembler (writes file contents to a flat blob)
 * - the runtime fs hooks (serves readFile, stat, readdir)
 * - the ESM loader (resolves imports, determines format)
 *
 * The index is serialized alongside the blob into the executable.
 * It must be deserializable without reading the blob contents.
 */
export interface SnapshotIndex {
  /**
   * Application identifier. Used as the snapshot root directory name.
   * POSIX: /snapshot/{appId}/
   * Windows: C:\snapshot\{appId}\
   */
  appId: string;

  /**
   * Entrypoint snapshot path. The runtime starts execution here.
   * The entry's format (ESM/CJS) determines the bootstrap strategy.
   */
  entrypoint: string;

  /** Module format of the entrypoint. */
  entrypointFormat: ModuleFormat;

  /**
   * All file entries, sorted by path (lexicographic, POSIX).
   * Deterministic ordering ensures identical manifest → identical blob.
   */
  entries: SnapshotEntry[];

  /**
   * Package boundaries, keyed by the snapshot path of the package.json.
   * The runtime uses this for module format determination and
   * exports/imports resolution.
   */
  packages: Record<string, SnapshotPackageBoundary>;

  /**
   * Pre-computed directory tree for readdir/stat support.
   * Keyed by directory snapshot path.
   */
  directories: Record<string, SnapshotDirectory>;

  /**
   * Total byte size of the blob (sum of all entry sizes).
   * Used for allocation during blob assembly.
   */
  blobSize: number;
}

// ─────────────────────────────────────────────────────────────────────
// Builder: PackagingManifest → SnapshotIndex
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a SnapshotIndex from a PackagingManifest.
 *
 * This function:
 * 1. Sorts entries deterministically by snapshot path
 * 2. Computes byte offsets (sequential, no gaps)
 * 3. Converts package metadata to runtime-optimized boundaries
 * 4. Builds the directory tree for readdir/stat
 *
 * Content hashes and sizes must be populated in the manifest files.
 * If they are not (e.g., during dry-run analysis), the index is still
 * structurally valid but offset/size/hash fields will be zero/empty.
 */
export function buildSnapshotIndex(
  manifest: PackagingManifest,
  fileSizes: Map<string, { size: number; hash: string }>,
): SnapshotIndex {
  // ── Sort entries deterministically ──
  const sortedPaths = Object.keys(manifest.files).sort();

  // ── Build entries with sequential offsets ──
  let currentOffset = 0;
  const entries: SnapshotEntry[] = [];

  for (const snapshotPath of sortedPaths) {
    const file = manifest.files[snapshotPath];
    const sizeInfo = fileSizes.get(snapshotPath) ?? { size: 0, hash: '' };

    entries.push({
      path: snapshotPath,
      kind: file.kind,
      format: file.format,
      packageBoundary: file.packageBoundary,
      offset: currentOffset,
      size: sizeInfo.size,
      contentHash: sizeInfo.hash,
    });

    currentOffset += sizeInfo.size;
  }

  // ── Build package boundaries ──
  const packages: Record<string, SnapshotPackageBoundary> = {};

  for (const [snapshotPath, meta] of Object.entries(manifest.packages)) {
    const dir = snapshotPath.replace(/\/package\.json$/, '');
    packages[snapshotPath] = {
      path: snapshotPath,
      name: meta.name,
      version: meta.version,
      type: meta.type,
      main: meta.main,
      exports: meta.exports,
      imports: meta.imports,
      directory: dir,
    };
  }

  // ── Build directory tree ──
  const directories = buildDirectoryTree(entries);

  return {
    appId: manifest.appId,
    entrypoint: manifest.entry.snapshotPath,
    entrypointFormat: manifest.entry.format,
    entries,
    packages,
    directories,
    blobSize: currentOffset,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Directory tree builder
// ─────────────────────────────────────────────────────────────────────

function buildDirectoryTree(
  entries: SnapshotEntry[],
): Record<string, SnapshotDirectory> {
  const dirs = new Map<
    string,
    { files: Set<string>; directories: Set<string> }
  >();

  function ensureDir(dirPath: string) {
    if (!dirs.has(dirPath)) {
      dirs.set(dirPath, { files: new Set(), directories: new Set() });
    }

    // Register this directory in its parent
    const parent = dirPath.substring(0, dirPath.lastIndexOf('/')) || '/';
    if (parent !== dirPath) {
      ensureDir(parent);
      const name = dirPath.substring(dirPath.lastIndexOf('/') + 1);
      dirs.get(parent)!.directories.add(name);
    }
  }

  for (const entry of entries) {
    const dirPath = entry.path.substring(0, entry.path.lastIndexOf('/'));
    const fileName = entry.path.substring(entry.path.lastIndexOf('/') + 1);

    ensureDir(dirPath);
    dirs.get(dirPath)!.files.add(fileName);
  }

  // Convert to sorted arrays for determinism
  const result: Record<string, SnapshotDirectory> = {};
  for (const [dirPath, contents] of dirs) {
    result[dirPath] = {
      path: dirPath,
      files: [...contents.files].sort(),
      directories: [...contents.directories].sort(),
    };
  }

  return result;
}
