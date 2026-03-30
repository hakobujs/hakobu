/**
 * Hakobu Snapshot Filesystem
 *
 * A read-only virtual filesystem backed by a SnapshotIndex and a flat
 * content blob. This is the runtime abstraction that sits between the
 * Node fs patches and the actual snapshot data.
 *
 * The SnapshotFS:
 * - serves file content from the blob
 * - provides stat/lstat metadata
 * - supports readdir for snapshot directories
 * - resolves canonical (real) paths within the snapshot
 * - detects whether a path is inside the snapshot
 * - rejects all write operations with EROFS
 *
 * It does NOT:
 * - monkey-patch Node's fs module (that's the runtime bootstrap's job)
 * - implement ESM/CJS loading (that's Task 6)
 * - handle native addon extraction (that's Task 9)
 *
 * All paths passed to this layer must be in the platform-native form
 * that the runtime receives from Node (e.g., /snapshot/app/... on POSIX,
 * C:\snapshot\app\... on Windows). The layer normalizes to POSIX
 * internally for index lookup.
 */

import type {
  SnapshotIndex,
  SnapshotEntry,
  SnapshotPackageBoundary,
} from './snapshot-index';

import type { ModuleFormat, FileKind } from './manifest';

// Re-export path utilities from the canonical module
export {
  isSnapshotPath,
  toNative,
  toCanonical,
  toFileUrl,
} from './snapshot-path';
import { isSnapshotPath, toCanonical, toNative } from './snapshot-path';

// ─────────────────────────────────────────────────────────────────────
// Error factories (match Node's error codes)
// ─────────────────────────────────────────────────────────────────────

function enoent(syscall: string, path: string): NodeJS.ErrnoException {
  const err = new Error(
    `${syscall} ENOENT: no such file or directory, '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  err.errno = -2;
  err.syscall = syscall;
  err.path = path;
  return err;
}

function enotdir(syscall: string, path: string): NodeJS.ErrnoException {
  const err = new Error(
    `${syscall} ENOTDIR: not a directory, '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = 'ENOTDIR';
  err.errno = -20;
  err.syscall = syscall;
  err.path = path;
  return err;
}

function erofs(syscall: string, path: string): NodeJS.ErrnoException {
  const err = new Error(
    `${syscall} EROFS: read-only file system, '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = 'EROFS';
  err.errno = -30;
  err.syscall = syscall;
  err.path = path;
  return err;
}

function eisdir(syscall: string, path: string): NodeJS.ErrnoException {
  const err = new Error(
    `${syscall} EISDIR: illegal operation on a directory, '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = 'EISDIR';
  err.errno = -21;
  err.syscall = syscall;
  err.path = path;
  return err;
}

// ─────────────────────────────────────────────────────────────────────
// Stat result
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal stat result compatible with what Node's fs.Stats provides.
 * Covers the fields that module resolution and common fs usage depend on.
 */
export interface SnapshotStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  /** Deterministic timestamps — all set to the same epoch. */
  mtime: Date;
  mtimeMs: number;
  atime: Date;
  atimeMs: number;
  ctime: Date;
  ctimeMs: number;
  birthtime: Date;
  birthtimeMs: number;
}

// Fixed epoch for deterministic stat timestamps
const EPOCH = new Date('2026-01-01T00:00:00Z');
const EPOCH_MS = EPOCH.getTime();

function fileStat(size: number): SnapshotStat {
  return {
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    size,
    mode: 0o100644,
    mtime: EPOCH,
    mtimeMs: EPOCH_MS,
    atime: EPOCH,
    atimeMs: EPOCH_MS,
    ctime: EPOCH,
    ctimeMs: EPOCH_MS,
    birthtime: EPOCH,
    birthtimeMs: EPOCH_MS,
  };
}

function dirStat(): SnapshotStat {
  return {
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    size: 0,
    mode: 0o40755,
    mtime: EPOCH,
    mtimeMs: EPOCH_MS,
    atime: EPOCH,
    atimeMs: EPOCH_MS,
    ctime: EPOCH,
    ctimeMs: EPOCH_MS,
    birthtime: EPOCH,
    birthtimeMs: EPOCH_MS,
  };
}

// ─────────────────────────────────────────────────────────────────────
// SnapshotFS
// ─────────────────────────────────────────────────────────────────────

export class SnapshotFS {
  private readonly index: SnapshotIndex;
  private readonly blob: Buffer;

  /** Entries keyed by POSIX snapshot path for O(1) lookup. */
  private readonly entryMap: Map<string, SnapshotEntry>;

  constructor(index: SnapshotIndex, blob: Buffer) {
    this.index = index;
    this.blob = blob;

    // Build O(1) entry map from the sorted array
    this.entryMap = new Map();
    for (const entry of index.entries) {
      this.entryMap.set(entry.path, entry);
    }
  }

  // ── Path classification ──

  /** Check if a platform-native path is inside the snapshot. */
  isSnapshot(nativePath: string): boolean {
    return isSnapshotPath(nativePath);
  }

  // ── Existence ──

  /** Check if a path exists in the snapshot (file or directory). */
  existsSync(nativePath: string): boolean {
    const p = toCanonical(nativePath);
    return this.entryMap.has(p) || p in this.index.directories;
  }

  // ── Stat ──

  /** Get file/directory metadata. Throws ENOENT if not found. */
  statSync(nativePath: string): SnapshotStat {
    const p = toCanonical(nativePath);

    const entry = this.entryMap.get(p);
    if (entry) return fileStat(entry.size);

    if (p in this.index.directories) return dirStat();

    throw enoent('stat', nativePath);
  }

  /** lstat is identical to stat — the snapshot has no symlinks. */
  lstatSync(nativePath: string): SnapshotStat {
    return this.statSync(nativePath);
  }

  // ── Read file ──

  /**
   * Read file content from the blob.
   * Returns a Buffer. Throws ENOENT or EISDIR.
   */
  readFileSync(nativePath: string): Buffer {
    const p = toCanonical(nativePath);

    if (p in this.index.directories) {
      throw eisdir('read', nativePath);
    }

    const entry = this.entryMap.get(p);
    if (!entry) throw enoent('open', nativePath);

    return this.blob.subarray(entry.offset, entry.offset + entry.size);
  }

  // ── Read directory ──

  /**
   * List directory contents. Returns file and directory names (not paths).
   * Throws ENOENT or ENOTDIR.
   */
  readdirSync(nativePath: string): string[] {
    const p = toCanonical(nativePath);

    // Check if it's a file, not a directory
    if (this.entryMap.has(p)) {
      throw enotdir('scandir', nativePath);
    }

    const dir = this.index.directories[p];
    if (!dir) throw enoent('scandir', nativePath);

    return [...dir.files, ...dir.directories].sort();
  }

  // ── Realpath ──

  /**
   * Resolve canonical path within the snapshot.
   * The snapshot has no symlinks, so this is just normalization.
   * Returns the platform-native normalized path.
   */
  realpathSync(nativePath: string): string {
    const p = toCanonical(nativePath);

    if (!this.entryMap.has(p) && !(p in this.index.directories)) {
      throw enoent('realpath', nativePath);
    }

    return toNative(p);
  }

  // ── Write rejection ──

  /** All write operations throw EROFS. */
  writeFileSync(nativePath: string): never {
    throw erofs('write', nativePath);
  }

  mkdirSync(nativePath: string): never {
    throw erofs('mkdir', nativePath);
  }

  unlinkSync(nativePath: string): never {
    throw erofs('unlink', nativePath);
  }

  // ── Module metadata (for ESM/CJS loader integration) ──

  /**
   * Get the module format of a snapshot file.
   * Returns null if the file is not a script or not found.
   */
  getModuleFormat(nativePath: string): ModuleFormat | null {
    const p = toCanonical(nativePath);
    const entry = this.entryMap.get(p);
    return entry?.format ?? null;
  }

  /**
   * Get the file kind of a snapshot file.
   * Returns null if not found.
   */
  getFileKind(nativePath: string): FileKind | null {
    const p = toCanonical(nativePath);
    const entry = this.entryMap.get(p);
    return entry?.kind ?? null;
  }

  /**
   * Get the package boundary (package.json) that governs a file.
   * Returns the SnapshotPackageBoundary or null.
   */
  getPackageBoundary(nativePath: string): SnapshotPackageBoundary | null {
    const p = toCanonical(nativePath);
    const entry = this.entryMap.get(p);
    if (!entry?.packageBoundary) return null;
    return this.index.packages[entry.packageBoundary] ?? null;
  }

  /**
   * Look up a package boundary by its package.json snapshot path.
   */
  getPackage(packageJsonPath: string): SnapshotPackageBoundary | null {
    const p = toCanonical(packageJsonPath);
    return this.index.packages[p] ?? null;
  }

  // ── Index access ──

  /** Get the snapshot entry for a path. */
  getEntry(nativePath: string): SnapshotEntry | null {
    const p = toCanonical(nativePath);
    return this.entryMap.get(p) ?? null;
  }

  /** Get the entrypoint path in platform-native form. */
  getEntrypoint(): string {
    return toNative(this.index.entrypoint);
  }

  /** Get the entrypoint module format. */
  getEntrypointFormat(): ModuleFormat {
    return this.index.entrypointFormat;
  }

  /** Get the application ID. */
  getAppId(): string {
    return this.index.appId;
  }
}
