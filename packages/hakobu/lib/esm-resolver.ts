/**
 * Hakobu ESM Resolver
 *
 * Resolves ESM specifiers against the snapshot filesystem and provides
 * module source + format for loading. This is the core resolution logic
 * used by the ESM loader hooks.
 *
 * Resolution follows Node 24 semantics:
 *   1. Built-in modules (node:*) → passthrough
 *   2. Absolute/relative specifiers → resolve within snapshot
 *   3. Bare specifiers → resolve through snapshot node_modules
 *   4. file: URLs → convert to snapshot path and resolve
 *
 * Format determination:
 *   .mjs → 'module'
 *   .cjs → 'commonjs'
 *   .js  → determined by nearest package.json "type" field
 *   .json → 'json'
 *   .wasm → 'wasm'
 */

import path from 'path';

import type { SnapshotFS } from './snapshot-fs';
import {
  toCanonical,
  toFileUrl,
  fromFileUrl,
} from './snapshot-path';
import {
  resolveExports,
  resolveImports,
  ESM_CONDITIONS,
} from './exports-resolver';

// ─────────────────────────────────────────────────────────────────────
// Resolution result
// ─────────────────────────────────────────────────────────────────────

export interface ResolveResult {
  /** Resolved file: URL. */
  url: string;
  /** Canonical snapshot path. */
  snapshotPath: string;
  /** Module format for Node's loader. */
  format: NodeModuleFormat;
}

/**
 * Node's expected format strings for the load hook.
 * These match what Node 24's ESM loader accepts.
 */
export type NodeModuleFormat =
  | 'module'
  | 'commonjs'
  | 'json'
  | 'wasm'
  | 'builtin';

export interface LoadResult {
  /** Module source as a string. */
  source: string;
  /** Module format. */
  format: NodeModuleFormat;
}

// ─────────────────────────────────────────────────────────────────────
// Built-in detection
// ─────────────────────────────────────────────────────────────────────

const BUILTINS = new Set([
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'test',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'sqlite',
]);

function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return BUILTINS.has(specifier);
}

// ─────────────────────────────────────────────────────────────────────
// Format determination
// ─────────────────────────────────────────────────────────────────────

function determineFormat(
  snapshotPath: string,
  sfs: SnapshotFS,
): NodeModuleFormat {
  const ext = path.extname(snapshotPath);

  // Extension-based (definitive)
  if (ext === '.mjs') return 'module';
  if (ext === '.cjs') return 'commonjs';
  if (ext === '.json') return 'json';
  if (ext === '.wasm') return 'wasm';

  // .js — use pre-resolved format from snapshot index
  const format = sfs.getModuleFormat(snapshotPath);
  if (format === 'esm') return 'module';
  if (format === 'cjs') return 'commonjs';

  // Fallback: check package boundary type
  const boundary = sfs.getPackageBoundary(snapshotPath);
  if (boundary?.type === 'module') return 'module';

  return 'commonjs';
}

// ─────────────────────────────────────────────────────────────────────
// Resolution extensions
// ─────────────────────────────────────────────────────────────────────

const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];

function tryResolveFile(snapshotPath: string, sfs: SnapshotFS): string | null {
  // Exact match
  if (sfs.existsSync(snapshotPath) && sfs.statSync(snapshotPath).isFile()) {
    return snapshotPath;
  }

  // Try extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = snapshotPath + ext;
    if (sfs.existsSync(withExt) && sfs.statSync(withExt).isFile()) {
      return withExt;
    }
  }

  // Directory with index
  if (
    sfs.existsSync(snapshotPath) &&
    sfs.statSync(snapshotPath).isDirectory()
  ) {
    // Check package.json main
    const pjPath = snapshotPath + '/package.json';
    if (sfs.existsSync(pjPath)) {
      const pj = sfs.getPackage(pjPath);
      if (pj?.main) {
        const mainPath = toCanonical(snapshotPath + '/' + pj.main);
        const resolved = tryResolveFile(mainPath, sfs);
        if (resolved) return resolved;
      }
    }

    // Index file fallback
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexPath = snapshotPath + '/index' + ext;
      if (sfs.existsSync(indexPath)) return indexPath;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// ESM Resolver
// ─────────────────────────────────────────────────────────────────────

export class ESMResolver {
  private readonly sfs: SnapshotFS;

  constructor(sfs: SnapshotFS) {
    this.sfs = sfs;
  }

  /**
   * Resolve a specifier to a snapshot file: URL and format.
   *
   * @param specifier - The import specifier (e.g., './helper.js', 'express', 'node:fs')
   * @param parentUrl - The file: URL of the importing module
   * @returns ResolveResult or null if the specifier should be handled by Node's default loader
   */
  resolve(specifier: string, parentUrl: string): ResolveResult | null {
    // 1. Built-ins — let Node handle
    if (isBuiltin(specifier)) return null;

    // 2. file: URL specifier
    if (specifier.startsWith('file://')) {
      const snapshotPath = fromFileUrl(specifier);
      if (snapshotPath) {
        return this.resolveSnapshotPath(snapshotPath, specifier);
      }
      return null; // non-snapshot file: URL → Node handles it
    }

    // 3. #-prefixed package imports
    if (specifier.startsWith('#')) {
      return this.resolvePackageImports(specifier, parentUrl);
    }

    // 4. Relative specifier (./foo, ../bar, /snapshot/...)
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return this.resolveRelative(specifier, parentUrl);
    }

    // 5. Bare specifier (package name)
    return this.resolveBare(specifier, parentUrl);
  }

  /**
   * Load a snapshot module's source and format.
   *
   * @param url - The resolved file: URL
   * @returns LoadResult or null if the URL is not a snapshot module
   */
  load(url: string): LoadResult | null {
    const snapshotPath = fromFileUrl(url);
    if (!snapshotPath) return null;

    if (!this.sfs.existsSync(snapshotPath)) return null;

    const source = this.sfs.readFileSync(snapshotPath).toString('utf8');
    const format = determineFormat(snapshotPath, this.sfs);

    return { source, format };
  }

  // ── Internal resolution ──

  private resolveSnapshotPath(
    snapshotPath: string,
    _originalSpecifier: string,
  ): ResolveResult | null {
    const resolved = tryResolveFile(snapshotPath, this.sfs);
    if (!resolved) return null;

    return {
      url: toFileUrl(resolved),
      snapshotPath: resolved,
      format: determineFormat(resolved, this.sfs),
    };
  }

  private resolveRelative(
    specifier: string,
    parentUrl: string,
  ): ResolveResult | null {
    // Convert parent URL to snapshot path
    const parentSnapshotPath = fromFileUrl(parentUrl);
    if (!parentSnapshotPath) return null; // parent is not in snapshot

    // Resolve relative to parent directory
    const parentDir = parentSnapshotPath.substring(
      0,
      parentSnapshotPath.lastIndexOf('/'),
    );
    const targetPath = toCanonical(parentDir + '/' + specifier);

    // Only resolve within snapshot
    if (!targetPath.startsWith('/snapshot/')) return null;

    return this.resolveSnapshotPath(targetPath, specifier);
  }

  private resolveBare(
    specifier: string,
    parentUrl: string,
  ): ResolveResult | null {
    const parentSnapshotPath = fromFileUrl(parentUrl);
    if (!parentSnapshotPath) return null;

    const pkgName = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const subpath = '.' + specifier.slice(pkgName.length);

    let searchDir = parentSnapshotPath.substring(
      0,
      parentSnapshotPath.lastIndexOf('/'),
    );
    const snapshotRoot = '/snapshot/' + this.sfs.getAppId();

    while (searchDir.startsWith(snapshotRoot)) {
      const nmDir = searchDir + '/node_modules/' + pkgName;

      if (this.sfs.existsSync(nmDir)) {
        const pkgJsonPath = nmDir + '/package.json';
        const pkg = this.sfs.existsSync(pkgJsonPath)
          ? this.sfs.getPackage(pkgJsonPath)
          : null;

        // ── exports map resolution ──
        // When "exports" is present, Node ONLY uses the exports map
        // for bare specifier resolution. "main" is ignored.
        if (pkg?.exports != null) {
          const resolved = resolveExports(pkg.exports, subpath, ESM_CONDITIONS);
          if (resolved && typeof resolved === 'string') {
            const fullPath = toCanonical(nmDir + '/' + resolved);
            const fileResolved = tryResolveFile(fullPath, this.sfs);
            if (fileResolved) {
              return {
                url: toFileUrl(fileResolved),
                snapshotPath: fileResolved,
                format: determineFormat(fileResolved, this.sfs),
              };
            }
          }
          // exports map present but resolution failed — do NOT fall
          // back to main/index (Node doesn't). Return null so the
          // diagnostic layer can report the error.
          return null;
        }

        // ── Legacy resolution (no exports map) ──
        if (subpath === '.') {
          if (pkg?.main) {
            const mainResolved = tryResolveFile(
              toCanonical(nmDir + '/' + pkg.main),
              this.sfs,
            );
            if (mainResolved) {
              return {
                url: toFileUrl(mainResolved),
                snapshotPath: mainResolved,
                format: determineFormat(mainResolved, this.sfs),
              };
            }
          }
          const indexResolved = tryResolveFile(nmDir + '/index', this.sfs);
          if (indexResolved) {
            return {
              url: toFileUrl(indexResolved),
              snapshotPath: indexResolved,
              format: determineFormat(indexResolved, this.sfs),
            };
          }
        } else {
          const subResolved = tryResolveFile(
            toCanonical(nmDir + '/' + subpath.slice(2)),
            this.sfs,
          );
          if (subResolved) {
            return {
              url: toFileUrl(subResolved),
              snapshotPath: subResolved,
              format: determineFormat(subResolved, this.sfs),
            };
          }
        }

        return null;
      }

      searchDir = searchDir.substring(0, searchDir.lastIndexOf('/'));
    }

    return null;
  }

  // ── #imports resolution ──

  private resolvePackageImports(
    specifier: string,
    parentUrl: string,
  ): ResolveResult | null {
    const parentSnapshotPath = fromFileUrl(parentUrl);
    if (!parentSnapshotPath) return null;

    // Find the package boundary for the importing file
    const boundary = this.sfs.getPackageBoundary(parentSnapshotPath);
    if (!boundary?.imports) return null;

    const resolved = resolveImports(
      boundary.imports,
      specifier,
      ESM_CONDITIONS,
    );
    if (!resolved) return null;

    // Resolved target is relative to the package directory
    const fullPath = toCanonical(boundary.directory + '/' + resolved);
    const fileResolved = tryResolveFile(fullPath, this.sfs);
    if (fileResolved) {
      return {
        url: toFileUrl(fileResolved),
        snapshotPath: fileResolved,
        format: determineFormat(fileResolved, this.sfs),
      };
    }

    return null;
  }
}
