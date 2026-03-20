/**
 * Hakobu Project Analyzer
 *
 * Analyzes a Node.js project and produces a normalized PackagingManifest.
 * This is the bridge between user config and the packaging pipeline.
 *
 * Analysis steps:
 *   1. Resolve project root and entrypoint
 *   2. Determine entrypoint module format
 *   3. Walk the dependency graph (require/import)
 *   4. Collect package.json metadata for resolution
 *   5. Classify files by kind
 *   6. Detect native addons
 *   7. Produce the manifest
 */

import fs from 'fs';
import path from 'path';
import * as babel from '@babel/parser';
import traverse from '@babel/traverse';

import type {
  PackagingManifest,
  ManifestEntrypoint,
  ManifestFile,
  ManifestWarning,
  PackageMetadata,
  NativeAddon,
  RuntimeTarget,
  ModuleFormat,
  FormatSource,
  FileKind,
  CompressionType,
  ExternalArtifact,
  WarningCategory,
} from './manifest';

// ─────────────────────────────────────────────────────────────────────
// Analyzer options (user-facing input, not the manifest)
// ─────────────────────────────────────────────────────────────────────

export interface AnalyzerOptions {
  /** Absolute path to the project root. */
  projectRoot: string;

  /**
   * Entrypoint path, relative to projectRoot or absolute.
   * If not provided, resolved from package.json "main" or "module".
   */
  entry?: string;

  /** Explicit module format override. */
  format?: ModuleFormat;

  /** Target platforms to build for. */
  targets?: RuntimeTarget[];

  /** Glob patterns for additional asset files. */
  assets?: string[];

  /** Package names or patterns to treat as external. */
  externals?: string[];

  /** Compression type for the snapshot. */
  compression?: CompressionType;

  /** Additional Node.js runtime flags. */
  runtimeFlags?: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Internal state
// ─────────────────────────────────────────────────────────────────────

interface RawPackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  imports?: unknown;
  dependencies?: Record<string, string>;
}

/** Cache of parsed package.json files by directory path. */
const packageJsonCache = new Map<string, { path: string; data: RawPackageJson } | null>();

// ─────────────────────────────────────────────────────────────────────
// Package.json utilities
// ─────────────────────────────────────────────────────────────────────

function findNearestPackageJson(fromDir: string): { path: string; data: RawPackageJson } | null {
  const root = path.parse(fromDir).root;
  let dir = fromDir;
  const visited: string[] = [];

  while (dir !== root) {
    if (packageJsonCache.has(dir)) {
      const cached = packageJsonCache.get(dir)!;
      // Backfill cache for all directories we traversed
      for (const d of visited) packageJsonCache.set(d, cached);
      return cached;
    }

    visited.push(dir);
    const pjPath = path.join(dir, 'package.json');
    if (fs.existsSync(pjPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(pjPath, 'utf8')) as RawPackageJson;
        const result = { path: pjPath, data };
        // Cache for this dir and all dirs we walked through
        for (const d of visited) packageJsonCache.set(d, result);
        return result;
      } catch {
        // Invalid JSON — treat as no package.json here, keep walking
      }
    }

    dir = path.dirname(dir);
  }

  // No package.json found — cache null for all visited
  for (const d of visited) packageJsonCache.set(d, null);
  return null;
}

function readPackageJson(pjPath: string): RawPackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Module format detection
// ─────────────────────────────────────────────────────────────────────

function detectModuleFormat(
  filePath: string,
  explicitFormat?: ModuleFormat
): { format: ModuleFormat; source: FormatSource } {
  if (explicitFormat) {
    return { format: explicitFormat, source: 'explicit' };
  }

  const ext = path.extname(filePath);

  if (ext === '.mjs') return { format: 'esm', source: 'extension' };
  if (ext === '.cjs') return { format: 'cjs', source: 'extension' };

  // .js or other — check nearest package.json "type"
  const pj = findNearestPackageJson(path.dirname(filePath));
  if (pj?.data.type === 'module') return { format: 'esm', source: 'package-type' };

  // Default: CJS (Node's default for .js without "type": "module")
  return { format: 'cjs', source: 'package-type' };
}

// ─────────────────────────────────────────────────────────────────────
// File classification
// ─────────────────────────────────────────────────────────────────────

function classifyFile(filePath: string): FileKind {
  const ext = path.extname(filePath);
  const base = path.basename(filePath);

  if (base === 'package.json') return 'package-json';
  if (ext === '.node') return 'native-addon';
  if (ext === '.wasm') return 'wasm';
  if (ext === '.json') return 'json';
  if (['.js', '.mjs', '.cjs'].includes(ext)) return 'script';

  return 'asset';
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot path computation
// ─────────────────────────────────────────────────────────────────────

function toSnapshotPath(absolutePath: string, projectRoot: string, appId: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  // Always use POSIX separators in snapshot paths
  const posix = relative.split(path.sep).join('/');
  return `/snapshot/${appId}/${posix}`;
}

// ─────────────────────────────────────────────────────────────────────
// Dependency extraction (require/import)
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract static dependency specifiers from a JS/MJS/CJS file.
 * Returns raw specifier strings (e.g., "./lib", "express", "fs").
 */
function extractDependencies(filePath: string, format: ModuleFormat): string[] {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const specifiers: string[] = [];

  try {
    const ast = babel.parse(source, {
      sourceType: format === 'esm' ? 'module' : 'script',
      // Allow both import and require regardless of sourceType
      plugins: ['importMeta', 'dynamicImport'],
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
    });

    traverse(ast, {
      // import "x" / import x from "x" / import { x } from "x"
      ImportDeclaration(path) {
        specifiers.push(path.node.source.value);
      },

      // require("x")
      CallExpression(path) {
        const { callee, arguments: args } = path.node;

        // require("x")
        if (
          callee.type === 'Identifier' &&
          callee.name === 'require' &&
          args.length >= 1 &&
          args[0].type === 'StringLiteral'
        ) {
          specifiers.push(args[0].value);
        }

        // import("x")
        if (callee.type === 'Import' && args.length >= 1 && args[0].type === 'StringLiteral') {
          specifiers.push(args[0].value);
        }
      },

      // export { x } from "x" / export * from "x"
      ExportNamedDeclaration(path) {
        if (path.node.source) {
          specifiers.push(path.node.source.value);
        }
      },
      ExportAllDeclaration(path) {
        specifiers.push(path.node.source.value);
      },
    });
  } catch {
    // Parse failure — return what we have (may be empty)
  }

  return specifiers;
}

// ─────────────────────────────────────────────────────────────────────
// Module resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a specifier to an absolute file path.
 * Returns null if the specifier can't be resolved (builtin, external, etc).
 */
function resolveSpecifier(
  specifier: string,
  fromFile: string,
  warnings: ManifestWarning[]
): string | null {
  // Skip Node builtins
  if (specifier.startsWith('node:') || isBuiltin(specifier)) {
    return null;
  }

  const fromDir = path.dirname(fromFile);

  // Relative specifier
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return resolveRelative(specifier, fromDir);
  }

  // Bare specifier (package name)
  return resolvePackage(specifier, fromDir, warnings);
}

const builtinSet = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'sys', 'test', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib', 'sqlite',
]);

function isBuiltin(specifier: string): boolean {
  const name = specifier.split('/')[0];
  return builtinSet.has(name);
}

const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];

function resolveRelative(specifier: string, fromDir: string): string | null {
  const base = path.resolve(fromDir, specifier);

  // Exact file
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return base;
  }

  // Try extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = base + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }

  // Directory with index
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexFile = path.join(base, `index${ext}`);
      if (fs.existsSync(indexFile)) {
        return indexFile;
      }
    }

    // Check package.json main in directory
    const dirPj = path.join(base, 'package.json');
    if (fs.existsSync(dirPj)) {
      const pj = readPackageJson(dirPj);
      if (pj?.main) {
        const mainPath = path.resolve(base, pj.main);
        if (fs.existsSync(mainPath)) return mainPath;
        for (const ext of RESOLVE_EXTENSIONS) {
          if (fs.existsSync(mainPath + ext)) return mainPath + ext;
        }
      }
    }
  }

  return null;
}

function resolvePackage(
  specifier: string,
  fromDir: string,
  warnings: ManifestWarning[]
): string | null {
  // Split "package/subpath" from "package"
  const parts = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const subpath = specifier.slice(parts.length) || '.';

  // Walk up node_modules
  let dir = fromDir;
  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgDir = path.join(dir, 'node_modules', parts);
    if (fs.existsSync(pkgDir)) {
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      const pj = fs.existsSync(pkgJsonPath) ? readPackageJson(pkgJsonPath) : null;

      if (subpath === '.') {
        // Package root — resolve via main/module/index
        if (pj?.main) {
          const resolved = resolveRelative(pj.main, pkgDir);
          if (resolved) return resolved;
        }
        // index fallback
        const resolved = resolveRelative('./index', pkgDir);
        if (resolved) return resolved;
      } else {
        // Subpath import
        const resolved = resolveRelative(subpath, pkgDir);
        if (resolved) return resolved;
      }

      // Couldn't resolve within found package
      warnings.push({
        category: 'unresolved-import',
        message: `Could not resolve '${specifier}' within ${pkgDir}`,
        file: null,
        suggestion: 'Check that the package exports this path',
      });
      return null;
    }

    dir = path.dirname(dir);
  }

  // Package not found at all
  warnings.push({
    category: 'unresolved-import',
    message: `Package '${parts}' not found in node_modules`,
    file: null,
    suggestion: `Run 'npm install' or 'pnpm install' to install dependencies`,
  });
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Package boundary detection
// ─────────────────────────────────────────────────────────────────────

function findPackageBoundary(filePath: string, projectRoot: string): string | null {
  const pj = findNearestPackageJson(path.dirname(filePath));
  if (!pj) return null;
  // Only count package.json files within the project root
  if (!pj.path.startsWith(projectRoot)) return null;
  return pj.path;
}

// ─────────────────────────────────────────────────────────────────────
// Main analyzer
// ─────────────────────────────────────────────────────────────────────

export async function analyze(options: AnalyzerOptions): Promise<PackagingManifest> {
  // Resolve symlinks in projectRoot so all paths are consistent
  const projectRoot = fs.realpathSync(options.projectRoot);
  const warnings: ManifestWarning[] = [];

  // Clear per-analysis caches
  packageJsonCache.clear();

  // ── 1. Resolve project package.json ──
  const rootPjPath = path.join(projectRoot, 'package.json');
  const rootPj = fs.existsSync(rootPjPath) ? readPackageJson(rootPjPath) : null;

  const appId = rootPj?.name?.replace(/^@[^/]+\//, '') || path.basename(projectRoot);

  // ── 2. Resolve entrypoint ──
  let entryPath: string;

  if (options.entry) {
    entryPath = path.isAbsolute(options.entry)
      ? options.entry
      : path.resolve(projectRoot, options.entry);
  } else if (rootPj?.main) {
    entryPath = path.resolve(projectRoot, rootPj.main);
  } else {
    // Default: index.js
    entryPath = path.resolve(projectRoot, 'index.js');
  }

  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `Entrypoint not found: ${entryPath}\n` +
      `Specify an entry via --entry or set "main" in package.json.`
    );
  }

  entryPath = fs.realpathSync(entryPath);

  const { format: entryFormat, source: entryFormatSource } = detectModuleFormat(
    entryPath,
    options.format
  );

  const entry: ManifestEntrypoint = {
    absolutePath: entryPath,
    snapshotPath: toSnapshotPath(entryPath, projectRoot, appId),
    format: entryFormat,
    formatSource: entryFormatSource,
  };

  // ── 3. Walk dependency graph ──
  const files: Record<string, ManifestFile> = {};
  const packagesMap: Record<string, PackageMetadata> = {};
  const nativeAddons: NativeAddon[] = [];
  const visited = new Set<string>();

  function addFile(absolutePath: string): ManifestFile | null {
    const realPath = fs.realpathSync(absolutePath);

    if (visited.has(realPath)) return null;
    visited.add(realPath);

    // Skip files outside the project root (shouldn't happen, but safety)
    if (!realPath.startsWith(projectRoot)) {
      warnings.push({
        category: 'unsupported-feature',
        message: `File outside project root: ${realPath}`,
        file: realPath,
        suggestion: 'Ensure all dependencies are installed within the project',
      });
      return null;
    }

    const snapshotPath = toSnapshotPath(realPath, projectRoot, appId);
    const kind = classifyFile(realPath);
    const pjBoundary = findPackageBoundary(realPath, projectRoot);
    const boundarySnapshot = pjBoundary ? toSnapshotPath(pjBoundary, projectRoot, appId) : null;

    let format: ModuleFormat | null = null;
    if (kind === 'script') {
      format = detectModuleFormat(realPath).format;
    }

    const file: ManifestFile = {
      absolutePath: realPath,
      snapshotPath,
      kind,
      format,
      packageBoundary: boundarySnapshot,
    };

    files[snapshotPath] = file;

    // Index package.json files for resolution metadata
    if (kind === 'package-json') {
      const pjData = readPackageJson(realPath);
      if (pjData) {
        packagesMap[snapshotPath] = {
          snapshotPath,
          name: pjData.name ?? null,
          version: pjData.version ?? null,
          type: (pjData.type === 'module' ? 'module' : pjData.type === 'commonjs' ? 'commonjs' : null),
          main: pjData.main ?? null,
          exports: pjData.exports ?? null,
          imports: pjData.imports ?? null,
          dependencies: pjData.dependencies ?? null,
        };
      }
    }

    // Track native addons
    if (kind === 'native-addon') {
      nativeAddons.push({
        snapshotPath,
        absolutePath: realPath,
        contentHash: '', // Computed during snapshot assembly, not analysis
        targetPlatform: null,
        targetArch: null,
      });
    }

    return file;
  }

  function walkFile(absolutePath: string) {
    const file = addFile(absolutePath);
    if (!file) return;

    // Only walk dependencies of scripts
    if (file.kind !== 'script') return;

    // Also include the package.json that governs this file
    const pjBoundary = findPackageBoundary(absolutePath, projectRoot);
    if (pjBoundary && !visited.has(fs.realpathSync(pjBoundary))) {
      addFile(pjBoundary);
    }

    // Extract and resolve dependencies
    const specifiers = extractDependencies(absolutePath, file.format!);

    for (const spec of specifiers) {
      const resolved = resolveSpecifier(spec, absolutePath, warnings);
      if (resolved) {
        walkFile(resolved);
      }
    }
  }

  // Start from entrypoint
  walkFile(entryPath);

  // Always include the root package.json if it exists
  if (rootPj && fs.existsSync(rootPjPath)) {
    addFile(rootPjPath);
  }

  // ── 4. Add user-specified assets ──
  // (Asset glob resolution is a future enhancement — placeholder for now)
  if (options.assets && options.assets.length > 0) {
    warnings.push({
      category: 'unsupported-feature',
      message: 'Asset glob patterns are not yet resolved by the analyzer',
      file: null,
      suggestion: 'Assets will be supported in a future release',
    });
  }

  // ── 5. Build externals list ──
  const externals: ExternalArtifact[] = (options.externals ?? []).map((pattern) => ({
    name: pattern,
    pattern,
    required: false,
  }));

  // ── 6. Assemble manifest ──
  const manifest: PackagingManifest = {
    projectRoot,
    appId,
    entry,
    files,
    packages: packagesMap,
    nativeAddons,
    externals,
    targets: options.targets ?? [],
    bundleMode: null,
    compression: options.compression ?? 'none',
    runtimeFlags: options.runtimeFlags ?? [],
    warnings,
  };

  return manifest;
}
