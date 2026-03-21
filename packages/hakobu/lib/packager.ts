/**
 * Hakobu Packager
 *
 * End-to-end packaging: project → analysis → executable.
 *
 * Uses the new manifest/analyzer for project analysis, then bridges
 * into the inherited producer/packer for binary assembly. This is the
 * pragmatic approach: the new analysis layers feed into the proven
 * binary injection mechanism.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { need, system } from '@hakobu/hakobu-fetch';

import { analyze } from './analyzer';
import { getAdapter } from './bundler';
import type { BundleOutput } from './bundler';
import type { PackagingManifest } from './manifest';
import { log } from './log';
import {
  STORE_CONTENT,
  STORE_STAT,
  STORE_LINKS,
  snapshotify,
} from './common';
import type { FileRecords, Target, SymLinks } from './types';
import packer from './packer';
import producer from './producer';
import { CompressType } from './compress_type';
import { plusx } from './chmod';
import { patchMachOExecutable, signMachOExecutable } from './mach-o';

// ─────────────────────────────────────────────────────────────────────
// Package options
// ─────────────────────────────────────────────────────────────────────

export interface PackageOptions {
  /** Absolute path to the project root. */
  projectRoot: string;

  /** Entry file (relative to project root or absolute). */
  entry?: string;

  /** Target specification (e.g., 'node24-macos-arm64'). Defaults to host. */
  target?: string;

  /** Output path for the executable. */
  output?: string;

  /** Asset glob patterns. */
  assets?: string[];

  /** External artifact names. */
  externals?: string[];

  /**
   * Bundle mode: pre-bundle the project before packaging.
   * Set to 'rolldown' to use Rolldown, or true for the default bundler.
   * When enabled, the project is bundled into a single JS file before
   * being fed into the packaging pipeline.
   */
  bundle?: boolean | string;

  /** Module names/patterns to keep external when bundling. */
  bundleExternal?: string[];
}

export interface PackageResult {
  /** Path to the produced executable. */
  outputPath: string;

  /** The analysis manifest. */
  manifest: PackagingManifest;

  /** Number of files packaged. */
  fileCount: number;

  /** Target that was built. */
  target: { platform: string; arch: string; nodeRange: string };
}

// ─────────────────────────────────────────────────────────────────────
// Core package function
// ─────────────────────────────────────────────────────────────────────

export async function packageApp(options: PackageOptions): Promise<PackageResult> {
  let { projectRoot } = options;
  let bundleOutput: BundleOutput | null = null;

  // ── 0. Bundle mode (optional pre-processing) ──
  if (options.bundle) {
    log.info('Bundling project...');

    const bundlerName = typeof options.bundle === 'string' ? options.bundle : 'rolldown';
    const adapter = getAdapter(bundlerName);

    // Determine entry for bundling
    const entry = options.entry || resolveEntryForBundle(projectRoot);

    // Determine app name from package.json
    let appName = 'app';
    const pkgJsonPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        appName = pkg.name || 'app';
      } catch {}
    }

    bundleOutput = await adapter.bundle({
      projectRoot,
      entry,
      external: options.bundleExternal,
      appName,
    });

    for (const w of bundleOutput.warnings) {
      log.warn(`[bundle] ${w.message}`);
    }

    // Switch to the bundled project for the rest of the pipeline
    projectRoot = bundleOutput.projectRoot;
    // Clear entry override — the bundle's package.json has the right main
    options = { ...options, entry: undefined };
  }

  try {
    return await packageAppInner(projectRoot, options, bundleOutput);
  } finally {
    // Clean up bundle temp directory
    if (bundleOutput) bundleOutput.cleanup();
  }
}

function resolveEntryForBundle(projectRoot: string): string {
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.main) return pkg.main;
      if (pkg.module) return pkg.module;
    } catch {}
  }
  // Fallback: common entry patterns
  for (const candidate of ['src/index.ts', 'src/index.js', 'index.ts', 'index.js']) {
    if (fs.existsSync(path.join(projectRoot, candidate))) return candidate;
  }
  throw new Error('Cannot determine entry for bundling. Specify --entry.');
}

async function packageAppInner(
  projectRoot: string,
  options: PackageOptions,
  bundleOutput: BundleOutput | null,
): Promise<PackageResult> {
  log.info('Analyzing project...');

  // ── 1. Analyze using new manifest pipeline ──
  const manifest = await analyze({
    projectRoot,
    entry: options.entry,
    assets: options.assets,
    externals: options.externals,
  });

  log.info(`  entry: ${manifest.entry.snapshotPath} (${manifest.entry.format})`);
  log.info(`  files: ${Object.keys(manifest.files).length}`);

  if (manifest.warnings.length > 0) {
    for (const w of manifest.warnings) {
      if (w.severity === 'error') {
        log.error(`[${w.category}] ${w.message}`);
      } else if (w.severity === 'warning') {
        log.warn(`[${w.category}] ${w.message}`);
      }
    }
  }

  // ── 2. Parse target ──
  const targetSpec = parseTarget(options.target);
  log.info(`Target: ${targetSpec.nodeRange}-${targetSpec.platform}-${targetSpec.arch}`);

  // ── 3. Fetch base binary ──
  log.info('Fetching base binary...');

  const binaryPath = await need({
    nodeRange: targetSpec.nodeRange,
    platform: targetSpec.platform,
    arch: targetSpec.arch,
  });

  log.info(`  base: ${binaryPath}`);

  // ── 3b. Strip macOS code signature before payload injection ──
  // The producer appends data past __LINKEDIT, which invalidates the adhoc
  // signature and makes subsequent codesign operations fail. Stripping the
  // signature first lets us patch + re-sign cleanly after production.
  let effectiveBinaryPath = binaryPath;
  if (targetSpec.platform === 'macos') {
    const stripped = binaryPath + '.unsigned';
    fs.copyFileSync(binaryPath, stripped);
    try {
      execFileSync('codesign', ['--remove-signature', stripped], { stdio: 'pipe' });
    } catch { /* already unsigned */ }
    effectiveBinaryPath = stripped;
  }

  // ── 4. Bridge: manifest → inherited FileRecords + Stripe format ──
  log.info('Building payload...');

  const { records, entrypoint, symLinks } = manifestToRecords(manifest);

  // ── 5. Pack using inherited packer ──
  const slash = targetSpec.platform === 'win' ? '\\' : '/';
  const backpack = packer({
    records,
    entrypoint,
    bytecode: false,
    symLinks,
  });

  // ── 6. Build target object for producer ──
  const outputPath = options.output || defaultOutputPath(manifest.appId, targetSpec);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const target: Target = {
    nodeRange: targetSpec.nodeRange,
    platform: targetSpec.platform as any,
    arch: targetSpec.arch,
    binaryPath: effectiveBinaryPath,
    output: path.resolve(outputPath),
    fabricator: {
      nodeRange: targetSpec.nodeRange,
      platform: system.hostPlatform as any,
      arch: system.hostArch,
      binaryPath: process.execPath,
      output: '',
      fabricator: null as any,
    },
  };

  // ── 7. Produce executable using inherited producer ──
  log.info(`Writing ${outputPath}...`);

  await producer({
    backpack,
    bakes: [],
    slash,
    target,
    symLinks,
    doCompress: CompressType.None,
    nativeBuild: false,
  });

  // ── 8. Post-production: Mach-O patching + codesign + chmod ──
  if (targetSpec.platform !== 'win') {
    if (targetSpec.platform === 'macos') {
      // Base was pre-stripped in step 3b, so __LINKEDIT patch + fresh sign works cleanly
      const buf = patchMachOExecutable(fs.readFileSync(target.output));
      fs.writeFileSync(target.output, buf);
      try {
        signMachOExecutable(target.output);
      } catch {
        if (targetSpec.arch === 'arm64') {
          log.warn('Unable to sign the macOS executable — it may not run on ARM64.');
        }
      }
    }
    await plusx(target.output);
  }

  log.info(`Done. Packaged ${Object.keys(manifest.files).length} files → ${outputPath}`);

  return {
    outputPath: path.resolve(outputPath),
    manifest,
    fileCount: Object.keys(manifest.files).length,
    target: targetSpec,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bridge: manifest → inherited FileRecords
// ─────────────────────────────────────────────────────────────────────

function manifestToRecords(manifest: PackagingManifest): {
  records: FileRecords;
  entrypoint: string;
  symLinks: SymLinks;
} {
  const records: FileRecords = {};
  const dirContents = new Map<string, string[]>();
  const isEsmEntry = manifest.entry.format === 'esm';

  // Add all manifest files to records
  for (const [snapshotPath, file] of Object.entries(manifest.files)) {
    const absPath = file.absolutePath;
    const content = fs.readFileSync(absPath);

    records[absPath] = {
      file: absPath,
      body: content,
      [STORE_CONTENT]: content,
      [STORE_STAT]: {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: content.length,
      },
    };

    const dir = path.dirname(absPath);
    if (!dirContents.has(dir)) dirContents.set(dir, []);
    dirContents.get(dir)!.push(absPath);
  }

  // For ESM entries, inject a CJS shim + hook source into the VFS
  let entrypoint = manifest.entry.absolutePath;

  if (isEsmEntry) {
    const { shimPath, shimContent, shimDir } = buildEsmBridge(manifest);
    records[shimPath] = {
      file: shimPath,
      body: shimContent,
      [STORE_CONTENT]: shimContent,
      [STORE_STAT]: {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: shimContent.length,
      },
    };
    entrypoint = shimPath;

    // Add shim to its directory listing
    if (!dirContents.has(shimDir)) dirContents.set(shimDir, []);
    dirContents.get(shimDir)!.push(shimPath);
  }

  // Add directory records with STORE_LINKS
  for (const [dir, files] of dirContents) {
    if (!records[dir]) {
      records[dir] = {
        file: dir,
        [STORE_LINKS]: files,
        [STORE_STAT]: {
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
          size: 0,
        },
      };
    }
  }

  return { records, entrypoint, symLinks: {} };
}

// ─────────────────────────────────────────────────────────────────────
// ESM Bridge
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a CJS shim that bootstraps ESM loading at runtime.
 *
 * The inherited prelude only supports CJS (Module._load). For ESM entries,
 * we inject a CJS shim as the entrypoint that:
 *   1. Registers synchronous ESM hooks via module.registerHooks()
 *      (runs in main thread — the patched fs is available)
 *   2. Dynamically import()s the real ESM entry
 */
function buildEsmBridge(manifest: PackagingManifest): {
  shimPath: string;
  shimContent: Buffer;
  shimDir: string;
} {
  const entryAbsPath = manifest.entry.absolutePath;
  const shimDir = path.dirname(entryAbsPath);
  const shimPath = path.join(shimDir, '__hakobu_esm_shim__.cjs');

  const entrySnapshotPath = snapshotify(entryAbsPath, '/');

  // Collect package.json paths for module format detection at runtime
  const pkgJsonAbsPaths = Object.values(manifest.files)
    .filter(f => f.kind === 'package-json')
    .map(f => f.absolutePath);

  const shimSource = `'use strict';
// Hakobu ESM Bridge — bootstraps ESM loading from the inherited CJS VFS
var { registerHooks } = require('node:module');
var fs = require('fs');

// Read package.json data for module type detection (using patched fs)
var pkgJsons = {};
${JSON.stringify(pkgJsonAbsPaths)}.forEach(function(absPath) {
  var snapPath = '/snapshot' + absPath;
  try { pkgJsons[snapPath] = JSON.parse(fs.readFileSync(snapPath, 'utf8')); } catch {}
});

function isSnapshotPath(p) { return p.startsWith('/snapshot/'); }

function getModuleFormat(filePath) {
  if (filePath.endsWith('.mjs')) return 'module';
  if (filePath.endsWith('.cjs')) return 'commonjs';
  if (filePath.endsWith('.json')) return 'json';
  var dir = filePath;
  while (dir !== '/') {
    dir = dir.substring(0, dir.lastIndexOf('/')) || '/';
    var pkgPath = dir + '/package.json';
    if (pkgJsons[pkgPath]) return pkgJsons[pkgPath].type === 'module' ? 'module' : 'commonjs';
  }
  return 'commonjs';
}

function snapshotExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function resolveFromSnapshot(specifier, parentPath) {
  var parentDir = parentPath.substring(0, parentPath.lastIndexOf('/'));
  var resolved;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    var parts = (parentDir + '/' + specifier).split('/');
    var normalized = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') normalized.pop();
      else if (parts[i] !== '.' && parts[i] !== '') normalized.push(parts[i]);
    }
    resolved = '/' + normalized.join('/');
  } else {
    resolved = specifier;
  }
  if (snapshotExists(resolved)) return resolved;
  if (snapshotExists(resolved + '.js')) return resolved + '.js';
  if (snapshotExists(resolved + '.mjs')) return resolved + '.mjs';
  if (snapshotExists(resolved + '/index.js')) return resolved + '/index.js';
  if (snapshotExists(resolved + '/index.mjs')) return resolved + '/index.mjs';
  return null;
}

registerHooks({
  resolve: function(specifier, context, nextResolve) {
    if (specifier.startsWith('node:') || specifier.startsWith('data:')) {
      return nextResolve(specifier, context);
    }
    // Stub unsupported runtime-specific protocols (bun:, deno:, etc.)
    if (specifier.startsWith('bun:') || specifier.startsWith('deno:')) {
      return { url: 'data:text/javascript,export default undefined;export var Database=class{constructor(){throw new Error("' + specifier + ' not available")}};', shortCircuit: true };
    }
    // Resolve file:// URLs to paths
    var targetPath = null;
    if (specifier.startsWith('file:///snapshot/')) {
      targetPath = new URL(specifier).pathname;
    } else if (specifier.startsWith('/snapshot/')) {
      targetPath = specifier;
    }
    if (targetPath && snapshotExists(targetPath)) {
      return { url: 'file://' + targetPath, shortCircuit: true };
    }
    // Relative imports from snapshot
    if (context.parentURL && context.parentURL.startsWith('file:///snapshot/')) {
      var parentPath = new URL(context.parentURL).pathname;
      if (specifier.startsWith('.')) {
        var resolved = resolveFromSnapshot(specifier, parentPath);
        if (resolved) return { url: 'file://' + resolved, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load: function(url, context, nextLoad) {
    if (url.startsWith('file:///snapshot/')) {
      var filePath = new URL(url).pathname;
      try {
        var source = fs.readFileSync(filePath, 'utf8');
        var format = getModuleFormat(filePath);
        return { format: format, source: source, shortCircuit: true };
      } catch {}
    }
    return nextLoad(url, context);
  }
});

// Import the real ESM entry
var entryUrl = 'file://${entrySnapshotPath}';
import(entryUrl).catch(function(err) { console.error(err); process.exit(1); });
`;

  return {
    shimPath,
    shimContent: Buffer.from(shimSource),
    shimDir,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function parseTarget(spec?: string): { nodeRange: string; platform: string; arch: string } {
  if (!spec || spec === 'host') {
    return {
      nodeRange: 'node24',
      platform: system.hostPlatform,
      arch: system.hostArch,
    };
  }

  const parts = spec.split('-');
  let nodeRange = 'node24';
  let platform = system.hostPlatform;
  let arch = system.hostArch;

  for (const part of parts) {
    if (part.startsWith('node')) nodeRange = part;
    else if (['linux', 'macos', 'win', 'alpine', 'linuxstatic'].includes(part)) platform = part;
    else if (['x64', 'arm64'].includes(part)) arch = part;
  }

  return { nodeRange, platform, arch };
}

function defaultOutputPath(appId: string, target: { platform: string; arch: string }): string {
  const ext = target.platform === 'win' ? '.exe' : '';
  return path.resolve(`${appId}-${target.platform}-${target.arch}${ext}`);
}
