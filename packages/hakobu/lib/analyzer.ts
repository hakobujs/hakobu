/**
 * Hakobu Project Analyzer
 *
 * Analyzes a Node.js project and produces a normalized PackagingManifest.
 * This is the bridge between user config and the packaging pipeline.
 *
 * ESM-first: follows Node 24 semantics. .js format is determined by the
 * nearest package.json "type" field. Packages with "exports" are flagged
 * when the analyzer cannot fully resolve them.
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
  DiagnosticSeverity,
  WarningCategory,
} from './manifest';
import { resolveExports, resolveImports, ESM_CONDITIONS, CJS_CONDITIONS } from './exports-resolver';

// ─────────────────────────────────────────────────────────────────────
// Analyzer options
// ─────────────────────────────────────────────────────────────────────

export interface AnalyzerOptions {
  projectRoot: string;
  entry?: string;
  format?: ModuleFormat;
  targets?: RuntimeTarget[];
  assets?: string[];
  externals?: string[];
  compression?: CompressionType;
  runtimeFlags?: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Diagnostic helper
// ─────────────────────────────────────────────────────────────────────

function diag(
  severity: DiagnosticSeverity,
  category: WarningCategory,
  message: string,
  file: string | null,
  suggestion: string | null,
): ManifestWarning {
  return { severity, category, message, file, suggestion };
}

// ─────────────────────────────────────────────────────────────────────
// Internal types
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
  pkg?: { scripts?: string[]; assets?: string[] };
}

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
      for (const d of visited) packageJsonCache.set(d, cached);
      return cached;
    }

    visited.push(dir);
    const pjPath = path.join(dir, 'package.json');
    if (fs.existsSync(pjPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(pjPath, 'utf8')) as RawPackageJson;
        const result = { path: pjPath, data };
        for (const d of visited) packageJsonCache.set(d, result);
        return result;
      } catch {
        // Invalid JSON — keep walking
      }
    }

    dir = path.dirname(dir);
  }

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
// Module format detection (Node 24 semantics)
// ─────────────────────────────────────────────────────────────────────

function detectModuleFormat(
  filePath: string,
  explicitFormat?: ModuleFormat
): { format: ModuleFormat; source: FormatSource } {
  if (explicitFormat) {
    return { format: explicitFormat, source: 'explicit' };
  }

  const ext = path.extname(filePath);

  // Node 24 rule 1: .mjs → always ESM
  if (ext === '.mjs') return { format: 'esm', source: 'extension' };
  // Node 24 rule 2: .cjs → always CJS
  if (ext === '.cjs') return { format: 'cjs', source: 'extension' };

  // Node 24 rule 3: .js → check nearest package.json "type"
  const pj = findNearestPackageJson(path.dirname(filePath));
  if (pj?.data.type === 'module') return { format: 'esm', source: 'package-type' };

  // Default: CJS (Node's default when no "type" field)
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
  const posix = relative.split(path.sep).join('/');
  return `/snapshot/${appId}/${posix}`;
}

// ─────────────────────────────────────────────────────────────────────
// Dependency extraction with diagnostic tracking
// ─────────────────────────────────────────────────────────────────────

interface ExtractedDep {
  specifier: string;
  /** true if the specifier is a non-literal expression (e.g., require(variable)) */
  dynamic: boolean;
  /** 'require' | 'import' | 'import-dynamic' | 'export-from' */
  kind: string;
}

function extractDependencies(filePath: string, format: ModuleFormat): ExtractedDep[] {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const deps: ExtractedDep[] = [];

  try {
    const ast = babel.parse(source, {
      sourceType: format === 'esm' ? 'module' : 'script',
      plugins: ['importMeta', 'dynamicImport'],
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
    });

    traverse(ast, {
      ImportDeclaration(p) {
        deps.push({ specifier: p.node.source.value, dynamic: false, kind: 'import' });
      },

      CallExpression(p) {
        const { callee, arguments: args } = p.node;

        // require(...)
        if (callee.type === 'Identifier' && callee.name === 'require' && args.length >= 1) {
          if (args[0].type === 'StringLiteral') {
            deps.push({ specifier: args[0].value, dynamic: false, kind: 'require' });
          } else {
            deps.push({ specifier: '<dynamic>', dynamic: true, kind: 'require' });
          }
        }

        // import(...)
        if (callee.type === 'Import' && args.length >= 1) {
          if (args[0].type === 'StringLiteral') {
            deps.push({ specifier: args[0].value, dynamic: false, kind: 'import-dynamic' });
          } else {
            deps.push({ specifier: '<dynamic>', dynamic: true, kind: 'import-dynamic' });
          }
        }
      },

      ExportNamedDeclaration(p) {
        if (p.node.source) {
          deps.push({ specifier: p.node.source.value, dynamic: false, kind: 'export-from' });
        }
      },
      ExportAllDeclaration(p) {
        deps.push({ specifier: p.node.source.value, dynamic: false, kind: 'export-from' });
      },
    });
  } catch {
    // Parse failure — return what we have
  }

  return deps;
}

// ─────────────────────────────────────────────────────────────────────
// Module resolution (ESM-aware)
// ─────────────────────────────────────────────────────────────────────

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
  return specifier.startsWith('node:') || builtinSet.has(specifier.split('/')[0]);
}

const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];

function resolveRelative(specifier: string, fromDir: string): string | null {
  const base = path.resolve(fromDir, specifier);

  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;

  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = base + ext;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }

  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexFile = path.join(base, `index${ext}`);
      if (fs.existsSync(indexFile)) return indexFile;
    }
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

/**
 * Resolve a bare package specifier. ESM-aware: when a package has an
 * "exports" field, the analyzer flags that it used legacy fallback
 * resolution, which may produce incorrect results for ESM-only exports.
 */
function resolvePackage(
  specifier: string,
  fromFile: string,
  warnings: ManifestWarning[]
): string | null {
  const pkgName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const subpath = specifier.slice(pkgName.length) || '.';

  let dir = path.dirname(fromFile);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const pkgDir = path.join(dir, 'node_modules', pkgName);
    if (fs.existsSync(pkgDir)) {
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      const pj = fs.existsSync(pkgJsonPath) ? readPackageJson(pkgJsonPath) : null;

      const hasExports = pj?.exports != null;

      // ── Exports map resolution ──
      // When "exports" is present, Node uses ONLY the exports map.
      // "main" is ignored for bare specifiers.
      if (hasExports) {
        const normalizedSubpath = '.' + specifier.slice(pkgName.length);
        const exportsResult = resolveExports(pj!.exports, normalizedSubpath, ESM_CONDITIONS);
        if (exportsResult && typeof exportsResult === 'string') {
          const resolved = resolveRelative(exportsResult, pkgDir);
          if (resolved) return resolved;
        }
        // exports present but couldn't resolve — do NOT fall back to main/index
        warnings.push(diag(
          'warning',
          'exports-not-resolved',
          `Could not resolve '${specifier}' via exports map in '${pkgName}'.`,
          fromFile,
          `Check that the exports map exposes this subpath.`,
        ));
        return null;
      }

      // ── Legacy resolution (no exports) ──
      if (subpath === '.') {
        if (pj?.main) {
          const resolved = resolveRelative(pj.main, pkgDir);
          if (resolved) return resolved;
        }
        const resolved = resolveRelative('./index', pkgDir);
        if (resolved) return resolved;
      } else {
        const resolved = resolveRelative(subpath, pkgDir);
        if (resolved) return resolved;
      }

      warnings.push(diag(
        'warning',
        'unresolved-import',
        `Could not resolve '${specifier}' within ${pkgDir}`,
        fromFile,
        'Check that the package exports this path.',
      ));
      return null;
    }

    dir = path.dirname(dir);
  }

  warnings.push(diag(
    'warning',
    'unresolved-import',
    `Package '${pkgName}' not found in node_modules`,
    fromFile,
    `Run 'npm install' or 'pnpm install' to install dependencies.`,
  ));
  return null;
}

function resolveSpecifier(
  specifier: string,
  fromFile: string,
  warnings: ManifestWarning[]
): string | null {
  if (isBuiltin(specifier)) return null;

  // #-prefixed package imports
  if (specifier.startsWith('#')) {
    const pj = findNearestPackageJson(path.dirname(fromFile));
    if (pj?.data.imports) {
      const resolved = resolveImports(pj.data.imports, specifier, ESM_CONDITIONS);
      if (resolved && typeof resolved === 'string') {
        const pkgDir = path.dirname(pj.path);
        return resolveRelative(resolved, pkgDir);
      }
    }
    warnings.push(diag(
      'warning',
      'imports-not-resolved',
      `Could not resolve '${specifier}' via imports map.`,
      fromFile,
      `Check that the nearest package.json has an "imports" entry for '${specifier}'.`,
    ));
    return null;
  }

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return resolveRelative(specifier, path.dirname(fromFile));
  }

  return resolvePackage(specifier, fromFile, warnings);
}

// ─────────────────────────────────────────────────────────────────────
// Package boundary detection
// ─────────────────────────────────────────────────────────────────────

function findPackageBoundary(filePath: string, projectRoot: string): string | null {
  const pj = findNearestPackageJson(path.dirname(filePath));
  if (!pj) return null;
  if (!pj.path.startsWith(projectRoot)) return null;
  return pj.path;
}

// ─────────────────────────────────────────────────────────────────────
// Main analyzer
// ─────────────────────────────────────────────────────────────────────

export async function analyze(options: AnalyzerOptions): Promise<PackagingManifest> {
  const projectRoot = fs.realpathSync(options.projectRoot);
  const warnings: ManifestWarning[] = [];

  packageJsonCache.clear();

  // ── 1. Resolve project package.json ──
  const rootPjPath = path.join(projectRoot, 'package.json');
  const rootPj = fs.existsSync(rootPjPath) ? readPackageJson(rootPjPath) : null;
  const appId = rootPj?.name?.replace(/^@[^/]+\//, '') || path.basename(projectRoot);

  // ── Legacy pkg config diagnostic ──
  if (rootPj?.pkg) {
    warnings.push(diag(
      'info',
      'legacy-pkg-config',
      `package.json contains a "pkg" configuration section. ` +
      `Hakobu does not yet read legacy pkg config fields (scripts, assets).`,
      rootPjPath,
      `Migrate to Hakobu config format or use --assets / --entry CLI flags. ` +
      `Legacy "pkg.scripts" and "pkg.assets" globs will be supported in a future release.`,
    ));
  }

  // ── Root-level imports map diagnostic ──
  if (rootPj?.imports) {
    warnings.push(diag(
      'warning',
      'imports-not-resolved',
      `Project package.json uses "imports" (subpath imports). ` +
      `#-prefixed specifiers in your code may not resolve correctly in the packaged app.`,
      rootPjPath,
      `Subpath imports resolution will be implemented before native ESM support is complete.`,
    ));
  }

  // ── 2. Resolve entrypoint ──
  let entryPath: string;

  if (options.entry) {
    entryPath = path.isAbsolute(options.entry)
      ? options.entry
      : path.resolve(projectRoot, options.entry);
  } else if (rootPj?.exports) {
    // If the project has "exports", use it to find the entry
    // For now, only handle the simple case: exports = "./file.js" or exports.".".default
    const entryFromExports = resolveExportsEntry(rootPj.exports, projectRoot);
    if (entryFromExports) {
      entryPath = entryFromExports;
    } else if (rootPj?.main) {
      entryPath = path.resolve(projectRoot, rootPj.main);
      warnings.push(diag(
        'warning',
        'exports-not-resolved',
        `Project has an "exports" field but Hakobu could not extract the entry from it. ` +
        `Falling back to "main": "${rootPj.main}".`,
        rootPjPath,
        `For complex exports maps, specify the entry explicitly with --entry.`,
      ));
    } else {
      entryPath = path.resolve(projectRoot, 'index.js');
    }
  } else if (rootPj?.main) {
    entryPath = path.resolve(projectRoot, rootPj.main);
  } else {
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

    if (!realPath.startsWith(projectRoot)) {
      warnings.push(diag(
        'warning',
        'unsupported-feature',
        `File outside project root: ${realPath}`,
        realPath,
        'Ensure all dependencies are installed within the project.',
      ));
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

    if (kind === 'native-addon') {
      // Compute content hash for deterministic extraction path
      const addonContent = fs.readFileSync(realPath);
      const addonHash = require('crypto')
        .createHash('sha256')
        .update(addonContent)
        .digest('hex');

      nativeAddons.push({
        snapshotPath,
        absolutePath: realPath,
        contentHash: addonHash,
        targetPlatform: null,
        targetArch: null,
      });
    }

    return file;
  }

  function walkFile(absolutePath: string) {
    const file = addFile(absolutePath);
    if (!file) return;
    if (file.kind !== 'script') return;

    const pjBoundary = findPackageBoundary(absolutePath, projectRoot);
    if (pjBoundary && !visited.has(fs.realpathSync(pjBoundary))) {
      addFile(pjBoundary);
    }

    const deps = extractDependencies(absolutePath, file.format!);

    for (const dep of deps) {
      // ── Dynamic specifier diagnostics ──
      if (dep.dynamic) {
        const category: WarningCategory = dep.kind === 'require' ? 'dynamic-require' : 'dynamic-import';
        warnings.push(diag(
          'warning',
          category,
          `${dep.kind}() with non-literal argument in ${path.basename(absolutePath)}. ` +
          `Hakobu cannot trace dynamic ${dep.kind === 'require' ? 'require' : 'import'} targets statically.`,
          absolutePath,
          dep.kind === 'require'
            ? `If the required module is known, add it to the assets or scripts list explicitly.`
            : `If the imported module is known, add it as a static import or to the scripts list.`,
        ));
        continue;
      }

      const resolved = resolveSpecifier(dep.specifier, absolutePath, warnings);
      if (resolved) {
        walkFile(resolved);
      }
    }
  }

  walkFile(entryPath);

  if (rootPj && fs.existsSync(rootPjPath)) {
    addFile(rootPjPath);
  }

  // ── 4. Asset glob placeholder ──
  if (options.assets && options.assets.length > 0) {
    warnings.push(diag(
      'info',
      'unsupported-feature',
      'Asset glob patterns are not yet resolved by the analyzer.',
      null,
      'Asset glob resolution will be supported in a future release. ' +
      'Files matched by these globs are not included in the manifest.',
    ));
  }

  // ── 5. Build externals ──
  const externals: ExternalArtifact[] = (options.externals ?? []).map((pattern) => ({
    name: pattern,
    pattern,
    required: false,
  }));

  // ── 6. Assemble manifest ──
  return {
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
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Try to extract a single entry file from a package.json "exports" field.
 * Handles the simplest common cases only:
 *   exports: "./file.js"
 *   exports: { ".": "./file.js" }
 *   exports: { ".": { "default": "./file.js" } }
 *   exports: { ".": { "import": "./file.js" } }
 */
function resolveExportsEntry(exports: unknown, projectRoot: string): string | null {
  if (typeof exports === 'string') {
    const resolved = path.resolve(projectRoot, exports);
    return fs.existsSync(resolved) ? resolved : null;
  }

  if (typeof exports === 'object' && exports !== null && !Array.isArray(exports)) {
    const map = exports as Record<string, unknown>;

    // { ".": ... }
    const dotEntry = map['.'];
    if (typeof dotEntry === 'string') {
      const resolved = path.resolve(projectRoot, dotEntry);
      return fs.existsSync(resolved) ? resolved : null;
    }

    // { ".": { "import": "...", "default": "..." } }
    if (typeof dotEntry === 'object' && dotEntry !== null) {
      const conditions = dotEntry as Record<string, unknown>;
      for (const key of ['import', 'default', 'node', 'require']) {
        if (typeof conditions[key] === 'string') {
          const resolved = path.resolve(projectRoot, conditions[key] as string);
          if (fs.existsSync(resolved)) return resolved;
        }
      }
    }
  }

  return null;
}
