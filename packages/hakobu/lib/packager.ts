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
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

import { need, system } from '@hakobu/hakobu-fetch';

import { analyze } from './analyzer';
import { getAdapter } from './bundler';
import type { BundleOutput } from './bundler';
import { shutdown as shutdownFabricator } from './fabricator';
import type { PackagingManifest } from './manifest';
import { log } from './log';
import {
  STORE_BLOB,
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
import {
  patchMachOExecutable, signMachOExecutable, notarizeMachOExecutable,
  signAppBundle, notarizeAppBundle,
} from './mach-o';
import { signWindowsExecutable, hasWindowsSigningCredentials } from './windows-sign';
import { injectPeMetadata } from './pe-metadata';
import type { ExeMetadata } from './pe-metadata';
import { createAppBundle } from './app-bundle';
import type { MacosBundleMetadata } from './app-bundle';
import { createAppDir, createAppImage, isLinuxPlatform } from './appdir';
import type { LinuxDesktopMetadata } from './appdir';

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

  /**
   * Bytecode compilation: compile JS to V8 bytecode before packaging.
   * Opt-in. Default: false (source-only mode).
   */
  bytecode?: boolean;

  /**
   * macOS code-signing identity.
   * Default: '-' (ad-hoc).
   * For distribution: 'Developer ID Application: Your Name (TEAMID)'.
   * Also read from HAKOBU_SIGN_IDENTITY env var.
   */
  signIdentity?: string;

  /**
   * Submit the signed macOS executable for Apple notarization.
   * Requires signIdentity (not ad-hoc), plus Apple credentials
   * via env vars or options.
   */
  notarize?: boolean;

  /**
   * Windows Authenticode certificate path (.pfx / .p12).
   * Also read from HAKOBU_WIN_CERT env var.
   */
  winCertPath?: string;

  /**
   * Windows Authenticode certificate password.
   * Also read from HAKOBU_WIN_CERT_PASSWORD env var.
   */
  winCertPassword?: string;

  /**
   * Executable metadata to inject into Windows PE executables.
   * Includes product name, version, description, company, icon.
   * See docs/exe-metadata.md for details.
   */
  metadata?: ExeMetadata;

  /**
   * Produce a macOS .app bundle instead of a raw executable.
   * Only valid for macOS targets. The output path becomes the .app
   * directory (e.g., dist/MyApp.app/).
   */
  appBundle?: boolean;

  /** macOS bundle metadata for Info.plist generation. */
  macos?: MacosBundleMetadata;

  /**
   * Produce a Linux AppDir instead of a raw executable.
   * Only valid for Linux targets. The output path becomes the .AppDir
   * directory (e.g., dist/MyApp.AppDir/).
   */
  appDir?: boolean;

  /** Linux desktop metadata for .desktop file generation. */
  linux?: LinuxDesktopMetadata;

  /**
   * Produce an AppImage from the AppDir output.
   * Implies appDir. Requires external `appimagetool` in PATH.
   * Only valid for Linux targets.
   */
  appImage?: boolean;

  /**
   * Snapshot compression algorithm.
   * 'brotli' or 'gzip'. Default: none (uncompressed).
   */
  compress?: 'brotli' | 'gzip';

  /**
   * V8 flags to bake into the executable.
   * Comma-separated or array. Each flag is prefixed with '--' if needed.
   * Example: 'expose-gc,max-heap-size=34' or ['--expose-gc']
   */
  options?: string[];
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

function prepareBaseBinary(
  targetSpec: { platform: string; arch: string; nodeRange: string },
  binaryPath: string,
): { effectiveBinaryPath: string; cleanup: () => void } {
  if (targetSpec.platform !== 'macos') {
    return { effectiveBinaryPath: binaryPath, cleanup: () => {} };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hakobu-base-'));
  const stripped = path.join(tmpDir, path.basename(binaryPath) + '.unsigned');
  fs.copyFileSync(binaryPath, stripped);

  try {
    execFileSync('codesign', ['--remove-signature', stripped], { stdio: 'pipe' });
  } catch {
    // Some cache entries are already unsigned; stripping is best-effort.
  }

  return {
    effectiveBinaryPath: stripped,
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Multi-target packaging
// ─────────────────────────────────────────────────────────────────────

const ALL_TARGETS = [
  'node24-linux-x64', 'node24-linux-arm64', 'node24-win-x64',
  'node24-macos-arm64', 'node24-macos-x64', 'node24-linuxstatic-x64',
];

export interface PackageMultipleOptions {
  projectRoot: string;
  targets: string[];
  outputDir?: string;
  entry?: string;
  assets?: string[];
  externals?: string[];
  bundle?: boolean | string;
  bundleExternal?: string[];
  signIdentity?: string;
  notarize?: boolean;
  winCertPath?: string;
  winCertPassword?: string;
  metadata?: ExeMetadata;
  appBundle?: boolean;
  macos?: MacosBundleMetadata;
  appDir?: boolean;
  linux?: LinuxDesktopMetadata;
  appImage?: boolean;
  compress?: 'brotli' | 'gzip';
  options?: string[];
}

export interface PackageMultipleResult {
  target: { platform: string; arch: string; nodeRange: string };
  status: 'success' | 'failed';
  outputPath: string;
  fileCount: number;
  sizeMB?: string;
  error?: string;
}

export async function packageMultiple(
  options: PackageMultipleOptions,
): Promise<PackageMultipleResult[]> {
  const { projectRoot } = options;
  const outputDir = path.resolve(options.outputDir || '.');

  // Expand 'all' target
  const targetSpecs = options.targets.flatMap(t =>
    t === 'all' ? ALL_TARGETS : t.split(','),
  ).filter(Boolean);

  if (targetSpecs.length === 0) {
    throw new Error('No targets specified.');
  }

  // Single target → delegate to packageApp for backward compat
  if (targetSpecs.length === 1) {
    const result = await packageApp({
      ...options,
      target: targetSpecs[0],
      output: path.join(outputDir, defaultOutputName(
        appIdFromProject(projectRoot),
        parseTarget(targetSpecs[0]),
      )),
    });
    return [{
      target: result.target,
      status: 'success',
      outputPath: result.outputPath,
      fileCount: result.fileCount,
    }];
  }

  log.info(`Multi-target packaging: ${targetSpecs.length} targets`);

  // ── Shared step: bundle (if requested) ──
  let effectiveRoot = projectRoot;
  let effectiveOptions = { ...options } as PackageOptions;
  let bundleOutput: BundleOutput | null = null;

  if (options.bundle) {
    log.info('Bundling project (shared across all targets)...');
    const bundlerName = typeof options.bundle === 'string' ? options.bundle : 'rolldown';
    const adapter = getAdapter(bundlerName);
    const entry = options.entry || resolveEntryForBundle(projectRoot);
    const appName = appIdFromProject(projectRoot);

    bundleOutput = await adapter.bundle({
      projectRoot, entry,
      external: options.bundleExternal,
      appName,
    });

    for (const w of bundleOutput.warnings) {
      log.warn(`[bundle] ${w.message}`);
    }

    effectiveRoot = bundleOutput.projectRoot;
    const bundleAssets = [
      ...(options.assets || []),
      ...bundleOutput.mapFiles,
    ];
    effectiveOptions = {
      ...effectiveOptions,
      entry: undefined,
      assets: bundleAssets.length > 0 ? bundleAssets : undefined,
    } as PackageOptions;
  }

  // ── Shared step: analyze ──
  log.info('Analyzing project (shared across all targets)...');
  const manifest = await analyze({
    projectRoot: effectiveRoot,
    entry: effectiveOptions.entry,
    assets: effectiveOptions.assets,
    externals: effectiveOptions.externals,
  });

  log.info(`  entry: ${manifest.entry.snapshotPath} (${manifest.entry.format})`);
  log.info(`  files: ${Object.keys(manifest.files).length}`);

  // ── Pre-fetch: download all base binaries in parallel ──
  // Each target has a unique platform-arch, so no cache file races.
  const parsedTargets = targetSpecs.map(spec => ({
    spec,
    ...parseTarget(spec),
  }));

  log.info(`\nFetching ${parsedTargets.length} base binaries...`);
  const fetchResults = await Promise.allSettled(
    parsedTargets.map(t =>
      need({ nodeRange: t.nodeRange, platform: t.platform, arch: t.arch })
        .then(binaryPath => {
          log.info(`  fetched: ${t.platform}-${t.arch}`);
          return binaryPath;
        })
    )
  );

  // Map fetch results by spec for lookup during per-target assembly
  const fetchedBinaries = new Map<string, string>();
  for (let i = 0; i < parsedTargets.length; i++) {
    const result = fetchResults[i];
    if (result.status === 'fulfilled') {
      fetchedBinaries.set(parsedTargets[i].spec, result.value);
    }
  }

  // ── Per-target: pack, produce ──
  fs.mkdirSync(outputDir, { recursive: true });

  const results: PackageMultipleResult[] = [];
  for (const spec of targetSpecs) {
    const targetSpec = parseTarget(spec);
    const outputName = defaultOutputName(manifest.appId, targetSpec);
    const outputPath = path.join(outputDir, outputName);

    log.info(`\n  [${targetSpec.platform}-${targetSpec.arch}]`);

    // Check if fetch succeeded for this target
    const prefetchedBinary = fetchedBinaries.get(spec);
    if (!prefetchedBinary) {
      const fetchResult = fetchResults[targetSpecs.indexOf(spec)];
      const fetchError = fetchResult.status === 'rejected' ? fetchResult.reason?.message : 'unknown';
      results.push({
        target: targetSpec,
        status: 'failed',
        outputPath,
        fileCount: 0,
        error: `Base binary fetch failed: ${fetchError}`,
      });
      continue;
    }

    try {
      const result = await packageAppForTarget(
        effectiveRoot, manifest, targetSpec, outputPath, effectiveOptions,
      );
      const sizeMB = fs.existsSync(result.outputPath)
        ? (fs.statSync(result.outputPath).size / 1024 / 1024).toFixed(0) + ' MB'
        : '';
      results.push({
        target: targetSpec,
        status: 'success',
        outputPath: result.outputPath,
        fileCount: result.fileCount,
        sizeMB,
      });
    } catch (err: any) {
      results.push({
        target: targetSpec,
        status: 'failed',
        outputPath,
        fileCount: 0,
        error: err.message,
      });
    }
  }

  // Clean up bundle
  if (bundleOutput) bundleOutput.cleanup();

  // Summary table
  log.info('\n=== Packaging Results ===\n');
  for (const r of results) {
    const label = `${r.target.platform}-${r.target.arch}`;
    if (r.status === 'success') {
      log.info(`  OK    ${label.padEnd(20)} → ${r.outputPath}  (${r.sizeMB})`);
    } else {
      log.error(`  FAIL  ${label.padEnd(20)} ${r.error}`);
    }
  }

  const ok = results.filter(r => r.status === 'success').length;
  const fail = results.filter(r => r.status === 'failed').length;
  log.info(`\n${ok} succeeded, ${fail} failed`);

  return results;
}

/**
 * Package a single target using a pre-analyzed manifest.
 * This is the per-target inner loop for multi-target packaging.
 */
async function packageAppForTarget(
  projectRoot: string,
  manifest: PackagingManifest,
  targetSpec: { nodeRange: string; platform: string; arch: string },
  outputPath: string,
  options: PackageOptions,
): Promise<PackageResult> {
  // Fetch base binary
  const binaryPath = await need({
    nodeRange: targetSpec.nodeRange,
    platform: targetSpec.platform,
    arch: targetSpec.arch,
  });

  const preparedBase = prepareBaseBinary(targetSpec, binaryPath);

  try {
    // Build payload
    const { records, entrypoint, symLinks } = manifestToRecords(manifest, options.bytecode);
    const slash = targetSpec.platform === 'win' ? '\\' : '/';
    const backpack = packer({ records, entrypoint, bytecode: !!options.bytecode, symLinks });

    // In app-bundle/appdir mode, write the raw executable to a temp path
    const usesTempOutput = (options.appBundle && targetSpec.platform === 'macos')
      || (options.appDir && isLinuxPlatform(targetSpec.platform));
    const producerOutput = usesTempOutput
      ? path.join(os.tmpdir(), `hakobu-wrap-${manifest.appId}-${Date.now()}`)
      : outputPath;
    fs.mkdirSync(path.dirname(path.resolve(producerOutput)), { recursive: true });

    const target: Target = {
      nodeRange: targetSpec.nodeRange,
      platform: targetSpec.platform as any,
      arch: targetSpec.arch,
      binaryPath: preparedBase.effectiveBinaryPath,
      output: path.resolve(producerOutput),
      fabricator: {
        nodeRange: targetSpec.nodeRange,
        platform: system.hostPlatform as any,
        arch: system.hostArch,
        // For bytecode compilation, the fabricator must use the patched base binary
        // (which has sourceless: true support). For source-only mode, it doesn't matter
        // because STORE_BLOB stripes are removed by the packer.
        binaryPath: options.bytecode ? binaryPath : process.execPath,
        output: '',
        fabricator: null as any,
      },
    };

    log.debug(`Producer input:`, [
      `  target: ${JSON.stringify(target.output)}`,
      `  bakes: ${JSON.stringify(options.options || [])}`,
      `  compress: ${options.compress || 'none'}`,
      `  stripes: ${backpack.stripes.length}`,
    ]);

    await producer({
      backpack, bakes: options.options || [], slash, target, symLinks,
      doCompress: resolveCompressType(options.compress), nativeBuild: false,
    });

    // Post-production
    let finalOutputPath = path.resolve(outputPath);

    if (targetSpec.platform === 'macos') {
      // Mach-O patch is always needed (fixes __LINKEDIT after payload injection)
      const buf = patchMachOExecutable(fs.readFileSync(target.output));
      fs.writeFileSync(target.output, buf);
      await plusx(target.output);

      if (options.appBundle) {
        // Bundle mode: wrap first, then sign/notarize the bundle
        finalOutputPath = createAppBundle({
          executablePath: target.output,
          outputPath: outputPath,
          appName: manifest.appId,
          macos: options.macos,
        });

        try { signAppBundle(finalOutputPath, options.signIdentity); } catch {}

        if (options.notarize) {
          await notarizeAppBundle({ executable: finalOutputPath });
        }
      } else {
        // Raw executable mode: sign/notarize the executable directly
        try { signMachOExecutable(target.output, options.signIdentity); } catch {}

        if (options.notarize) {
          await notarizeMachOExecutable({ executable: target.output });
        }
      }
    } else if (targetSpec.platform === 'win') {
      // Metadata injection must happen BEFORE signing
      if (options.metadata) {
        await injectPeMetadata(target.output, options.metadata);
      }
      if (hasWindowsSigningCredentials(options.winCertPath)) {
        signWindowsExecutable({
          executable: target.output,
          certPath: options.winCertPath,
          certPassword: options.winCertPassword,
        });
      }
    } else {
      await plusx(target.output);

      // AppDir wrapping (Linux only, opt-in)
      if (options.appDir && isLinuxPlatform(targetSpec.platform)) {
        const appDirPath = createAppDir({
          executablePath: target.output,
          outputPath: outputPath,
          appName: manifest.appId,
          linux: options.linux,
        });

        if (options.appImage) {
          // AppImage: build from AppDir, then clean up the AppDir
          finalOutputPath = createAppImage({
            appDirPath,
            outputPath: outputPath,
            arch: targetSpec.arch,
          });
          try { fs.rmSync(appDirPath, { recursive: true, force: true }); } catch {}
        } else {
          finalOutputPath = appDirPath;
        }
      }
    }

    // Kill fabricator child processes (bytecode compilation spawns long-lived workers)
    shutdownFabricator();

    return {
      outputPath: finalOutputPath,
      manifest,
      fileCount: Object.keys(manifest.files).length,
      target: targetSpec,
    };
  } finally {
    preparedBase.cleanup();
  }
}

function appIdFromProject(projectRoot: string): string {
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      return pkg.name || 'app';
    } catch {}
  }
  return 'app';
}

function defaultOutputName(appId: string, target: { platform: string; arch: string }): string {
  const ext = target.platform === 'win' ? '.exe' : '';
  return `${appId}-${target.platform}-${target.arch}${ext}`;
}

// ─────────────────────────────────────────────────────────────────────
// Core package function (single target — unchanged)
// ─────────────────────────────────────────────────────────────────────

export async function packageApp(options: PackageOptions): Promise<PackageResult> {
  // ── App bundle validation ──
  if (options.appBundle) {
    const targetSpec = parseTarget(options.target || '');
    if (targetSpec.platform !== 'macos') {
      throw new Error(
        `--app-bundle is only supported for macOS targets (got ${targetSpec.platform}).\n` +
        'macOS .app bundles require a Mach-O executable.'
      );
    }
  }

  // ── AppImage implies AppDir ──
  if (options.appImage) {
    options.appDir = true;
  }

  // ── AppDir validation ──
  if (options.appDir) {
    const targetSpec = parseTarget(options.target || '');
    if (!isLinuxPlatform(targetSpec.platform)) {
      throw new Error(
        `--appdir is only supported for Linux targets (got ${targetSpec.platform}).\n` +
        'AppDir requires an ELF executable.'
      );
    }
  }

  // ── Bytecode mode validation ──
  if (options.bytecode && options.bundle) {
    throw new Error(
      'Bytecode mode (--bytecode) cannot be combined with bundle mode (--bundle).\n' +
      'Bundle mode produces ESM output which is not compatible with V8 bytecode compilation.\n' +
      'Use one or the other, not both.'
    );
  }

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
    // Include source map files as assets so they end up in the snapshot
    const bundleAssets = [
      ...(options.assets || []),
      ...bundleOutput.mapFiles,
    ];
    options = { ...options, entry: undefined, assets: bundleAssets.length > 0 ? bundleAssets : undefined };
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

  log.debug('Manifest details:', [
    `  projectRoot: ${projectRoot}`,
    `  appId: ${manifest.appId}`,
    `  file count: ${Object.keys(manifest.files).length}`,
    `  warnings: ${manifest.warnings.length}`,
  ]);

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
  const preparedBase = prepareBaseBinary(targetSpec, binaryPath);

  try {
    // ── 4. Bridge: manifest → inherited FileRecords + Stripe format ──
    log.info('Building payload...');

    const { records, entrypoint, symLinks } = manifestToRecords(manifest, options.bytecode);

    // ── 5. Pack using inherited packer ──
    const slash = targetSpec.platform === 'win' ? '\\' : '/';
    const backpack = packer({
      records,
      entrypoint,
      bytecode: !!options.bytecode,
      symLinks,
    });

    // ── 6. Build target object for producer ──
    const requestedOutput = options.output || defaultOutputPath(manifest.appId, targetSpec);
    // In app-bundle/appdir mode, the producer writes to a temp file; wrapper moves it in
    const usesTempOutput = (options.appBundle && targetSpec.platform === 'macos')
      || (options.appDir && isLinuxPlatform(targetSpec.platform));
    const outputPath = usesTempOutput
      ? path.join(os.tmpdir(), `hakobu-wrap-${manifest.appId}-${Date.now()}`)
      : requestedOutput;
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

    const target: Target = {
      nodeRange: targetSpec.nodeRange,
      platform: targetSpec.platform as any,
      arch: targetSpec.arch,
      binaryPath: preparedBase.effectiveBinaryPath,
      output: path.resolve(outputPath),
      fabricator: {
        nodeRange: targetSpec.nodeRange,
        platform: system.hostPlatform as any,
        arch: system.hostArch,
        binaryPath: options.bytecode ? binaryPath : process.execPath,
        output: '',
        fabricator: null as any,
      },
    };

    // ── 7. Produce executable using inherited producer ──
    log.info(`Writing ${outputPath}...`);

    log.debug('Producer input:', [
      `  output: ${path.resolve(outputPath)}`,
      `  bakes: ${JSON.stringify(options.options || [])}`,
      `  compress: ${options.compress || 'none'}`,
      `  bytecode: ${!!options.bytecode}`,
      `  stripes: ${backpack.stripes.length}`,
    ]);

    await producer({
      backpack,
      bakes: options.options || [],
      slash,
      target,
      symLinks,
      doCompress: resolveCompressType(options.compress),
      nativeBuild: false,
    });

    // ── 8. Post-production: signing + chmod ──
    log.debug(`Post-production: platform=${targetSpec.platform}, appBundle=${!!options.appBundle}, appDir=${!!options.appDir}`);
    let finalOutputPath = path.resolve(requestedOutput);

    if (targetSpec.platform === 'macos') {
      // Base was pre-stripped in step 3b, so __LINKEDIT patch + fresh sign works cleanly
      const buf = patchMachOExecutable(fs.readFileSync(target.output));
      fs.writeFileSync(target.output, buf);
      await plusx(target.output);

      if (options.appBundle) {
        // Bundle mode: wrap first, then sign/notarize the bundle
        finalOutputPath = createAppBundle({
          executablePath: target.output,
          outputPath: requestedOutput,
          appName: manifest.appId,
          macos: options.macos,
        });

        try {
          signAppBundle(finalOutputPath, options.signIdentity);
        } catch {
          if (targetSpec.arch === 'arm64') {
            log.warn('Unable to sign the macOS app bundle — it may not run on ARM64.');
          }
        }

        if (options.notarize) {
          await notarizeAppBundle({ executable: finalOutputPath });
        }
      } else {
        // Raw executable mode: sign/notarize the executable directly
        try {
          signMachOExecutable(target.output, options.signIdentity);
        } catch {
          if (targetSpec.arch === 'arm64') {
            log.warn('Unable to sign the macOS executable — it may not run on ARM64.');
          }
        }

        if (options.notarize) {
          await notarizeMachOExecutable({ executable: target.output });
        }
      }
    } else if (targetSpec.platform === 'win') {
      // Metadata injection must happen BEFORE signing
      if (options.metadata) {
        await injectPeMetadata(target.output, options.metadata);
      }
      if (hasWindowsSigningCredentials(options.winCertPath)) {
        signWindowsExecutable({
          executable: target.output,
          certPath: options.winCertPath,
          certPassword: options.winCertPassword,
        });
      }
    } else {
      await plusx(target.output);

      // AppDir wrapping (Linux only, opt-in)
      if (options.appDir && isLinuxPlatform(targetSpec.platform)) {
        const appDirPath = createAppDir({
          executablePath: target.output,
          outputPath: requestedOutput,
          appName: manifest.appId,
          linux: options.linux,
        });

        if (options.appImage) {
          finalOutputPath = createAppImage({
            appDirPath,
            outputPath: requestedOutput,
            arch: targetSpec.arch,
          });
          try { fs.rmSync(appDirPath, { recursive: true, force: true }); } catch {}
        } else {
          finalOutputPath = appDirPath;
        }
      }
    }

    shutdownFabricator();

    log.info(`Done. Packaged ${Object.keys(manifest.files).length} files → ${finalOutputPath}`);

    return {
      outputPath: finalOutputPath,
      manifest,
      fileCount: Object.keys(manifest.files).length,
      target: targetSpec,
    };
  } finally {
    preparedBase.cleanup();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Bridge: manifest → inherited FileRecords
// ─────────────────────────────────────────────────────────────────────

function manifestToRecords(manifest: PackagingManifest, bytecode?: boolean): {
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

    const record: any = {
      file: absPath,
      body: content,
      [STORE_CONTENT]: content,
      [STORE_STAT]: {
        size: content.length,
        isFileValue: true,
        isDirectoryValue: false,
        isSocketValue: false,
        isSymbolicLinkValue: false,
      },
    };

    // Bytecode mode: add STORE_BLOB for CJS scripts.
    // The fabricator will compile the source to V8 cached data.
    // ESM scripts are NOT bytecode-compiled (vm.Script is CJS-only).
    if (bytecode && file.kind === 'script' && file.format === 'cjs') {
      record[STORE_BLOB] = content;
    }

    records[absPath] = record;

    // Build the full directory tree — not just direct parents, but all
    // intermediate dirs up to the project root. This is needed for CJS
    // node_modules resolution: require('pkg') walks up directories
    // checking node_modules/pkg, so the VFS must have directory entries
    // at every level.
    let dir = path.dirname(absPath);
    if (!dirContents.has(dir)) dirContents.set(dir, []);
    dirContents.get(dir)!.push(path.basename(absPath));

    // Walk up and register intermediate directories as children of their parents
    const projectRoot = fs.realpathSync(manifest.projectRoot || path.dirname(manifest.entry.absolutePath));
    while (dir !== projectRoot && dir !== path.dirname(dir)) {
      const parent = path.dirname(dir);
      if (!dirContents.has(parent)) dirContents.set(parent, []);
      const dirBasename = path.basename(dir);
      if (!dirContents.get(parent)!.includes(dirBasename)) {
        dirContents.get(parent)!.push(dirBasename);
      }
      dir = parent;
    }
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
        size: shimContent.length,
        isFileValue: true,
        isDirectoryValue: false,
        isSocketValue: false,
        isSymbolicLinkValue: false,
      },
    };
    entrypoint = shimPath;

    // Add shim to its directory listing
    if (!dirContents.has(shimDir)) dirContents.set(shimDir, []);
    dirContents.get(shimDir)!.push(path.basename(shimPath));
  }

  // Add directory records with STORE_LINKS
  for (const [dir, files] of dirContents) {
    if (!records[dir]) {
      records[dir] = {
        file: dir,
        [STORE_LINKS]: files,
        [STORE_STAT]: {
          size: 0,
          isFileValue: false,
          isDirectoryValue: true,
          isSocketValue: false,
          isSymbolicLinkValue: false,
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

  // Collect package.json paths for module format detection at runtime
  const pkgJsonAbsPaths = Object.values(manifest.files)
    .filter(f => f.kind === 'package-json')
    .map(f => f.absolutePath);

  const shimSource = `'use strict';
// Hakobu ESM Bridge — bootstraps ESM loading from the inherited CJS VFS

// Enable source maps before any module loading. The patched base binary is
// built with --without-node-options which ignores NODE_OPTIONS, so
// --enable-source-maps via env has no effect. This programmatic call
// ensures source maps work when .map files are present in the snapshot.
if (typeof process.setSourceMapsEnabled === 'function') {
  process.setSourceMapsEnabled(true);
}

var { registerHooks } = require('node:module');
var fs = require('fs');
var pathMod = require('path');
var { pathToFileURL, fileURLToPath } = require('url');

// Platform detection: Windows uses C:\\snapshot, POSIX uses /snapshot
var isWin = process.platform === 'win32';
var snapRoot = isWin ? 'C:\\\\snapshot' : '/snapshot';
var sep = isWin ? '\\\\' : '/';

// Normalize a snapshot path to POSIX for URL/map keys (internal canonical form)
function toCanonical(p) {
  if (isWin && p.startsWith('C:\\\\snapshot')) return p.slice(2).replace(/\\\\/g, '/');
  return p;
}

// Convert canonical back to native snapshot path for fs operations
function toNative(p) {
  if (isWin && p.startsWith('/snapshot')) return 'C:' + p.replace(/\\//g, '\\\\');
  return p;
}

// Read package.json data for module type detection (using patched fs)
// absPath is a host absolute path (e.g. /home/user/project/package.json or D:\\a\\project\\package.json)
// Convert to canonical snapshot path: strip drive letter, normalize to POSIX, prepend /snapshot
var pkgJsons = {};
${JSON.stringify(pkgJsonAbsPaths)}.forEach(function(absPath) {
  var posix = absPath.replace(/\\\\/g, '/');
  if (/^[A-Z]:/i.test(posix)) posix = posix.slice(2);
  var canonical = '/snapshot' + posix;
  var native = toNative(canonical);
  try { pkgJsons[canonical] = JSON.parse(fs.readFileSync(native, 'utf8')); } catch {}
});

function isSnapshotUrl(url) {
  if (url.startsWith('file:///snapshot/')) return true;
  // Windows: file:///C:/snapshot/
  if (isWin && /^file:\\/\\/\\/[A-Z]:\\/snapshot\\//i.test(url)) return true;
  return false;
}

function urlToCanonical(url) {
  var p = fileURLToPath(url);
  return toCanonical(p);
}

function canonicalToUrl(canonical) {
  return pathToFileURL(toNative(canonical)).href;
}

function getModuleFormat(canonical) {
  if (canonical.endsWith('.mjs')) return 'module';
  if (canonical.endsWith('.cjs')) return 'commonjs';
  if (canonical.endsWith('.json')) return 'json';
  var dir = canonical;
  while (dir !== '/') {
    dir = dir.substring(0, dir.lastIndexOf('/')) || '/';
    var pkgPath = dir + '/package.json';
    if (pkgJsons[pkgPath]) return pkgJsons[pkgPath].type === 'module' ? 'module' : 'commonjs';
  }
  return 'commonjs';
}

function snapshotExists(canonical) {
  try { return fs.existsSync(toNative(canonical)); } catch { return false; }
}

function resolveFromSnapshot(specifier, parentCanonical) {
  var parentDir = parentCanonical.substring(0, parentCanonical.lastIndexOf('/'));
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
    // Resolve file:// URLs to snapshot paths
    if (isSnapshotUrl(specifier)) {
      var canonical = urlToCanonical(specifier);
      if (snapshotExists(canonical)) {
        return { url: canonicalToUrl(canonical), shortCircuit: true };
      }
    }
    // Absolute snapshot path (POSIX)
    if (specifier.startsWith('/snapshot/') && snapshotExists(specifier)) {
      return { url: canonicalToUrl(specifier), shortCircuit: true };
    }
    // Relative/bare imports from snapshot
    if (context.parentURL && isSnapshotUrl(context.parentURL)) {
      var parentCanonical = urlToCanonical(context.parentURL);
      if (specifier.startsWith('.')) {
        var resolved = resolveFromSnapshot(specifier, parentCanonical);
        if (resolved) return { url: canonicalToUrl(resolved), shortCircuit: true };
      }
      // #imports specifier — resolve from nearest package.json imports map
      if (specifier.startsWith('#')) {
        var dir = parentCanonical;
        while (dir.startsWith('/snapshot/')) {
          dir = dir.substring(0, dir.lastIndexOf('/')) || '/';
          var pkgPath = dir + '/package.json';
          if (pkgJsons[pkgPath] && pkgJsons[pkgPath].imports) {
            var mapping = pkgJsons[pkgPath].imports[specifier];
            if (typeof mapping === 'string') {
              var target = resolveFromSnapshot(mapping, dir + '/dummy');
              if (target) return { url: canonicalToUrl(target), shortCircuit: true };
            }
          }
        }
      }
      // Bare specifier — resolve from node_modules with exports map support
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('#')) {
        var parts = specifier.split('/');
        var pkgName = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
        var subpath = '.' + specifier.slice(pkgName.length);
        if (subpath === '.') subpath = '.';
        var searchDir = parentCanonical;
        while (searchDir.startsWith('/snapshot/')) {
          searchDir = searchDir.substring(0, searchDir.lastIndexOf('/')) || '/';
          var nmPkgJson = searchDir + '/node_modules/' + pkgName + '/package.json';
          if (pkgJsons[nmPkgJson]) {
            var pkg = pkgJsons[nmPkgJson];
            var pkgDir = nmPkgJson.substring(0, nmPkgJson.lastIndexOf('/'));
            var resolved = null;
            if (pkg.exports) {
              var exportEntry = null;
              if (typeof pkg.exports === 'string') {
                if (subpath === '.') exportEntry = pkg.exports;
              } else if (typeof pkg.exports === 'object') {
                exportEntry = pkg.exports[subpath];
                if (typeof exportEntry === 'object' && exportEntry !== null) {
                  exportEntry = exportEntry.import || exportEntry.node || exportEntry.default || null;
                }
              }
              if (typeof exportEntry === 'string') {
                resolved = resolveFromSnapshot(exportEntry, pkgDir + '/dummy');
              }
            } else if (subpath === '.' && pkg.main) {
              resolved = resolveFromSnapshot('./' + pkg.main, pkgDir + '/dummy');
            }
            if (resolved) return { url: canonicalToUrl(resolved), shortCircuit: true };
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load: function(url, context, nextLoad) {
    if (isSnapshotUrl(url)) {
      var canonical = urlToCanonical(url);
      try {
        var source = fs.readFileSync(toNative(canonical), 'utf8');
        var format = getModuleFormat(canonical);
        // Inline sidecar source maps so --enable-source-maps works in packaged mode.
        // Node reads source maps from the source text, not from separate fs reads,
        // when the map is a data: URL. This avoids depending on Node internals
        // reading .map files through the prelude's patched fs.
        var mapMatch = source.match(/\\/\\/# sourceMappingURL=([^\\n]+\\.map)\\s*$/);
        if (mapMatch) {
          var mapFile = mapMatch[1];
          var mapCanonical = canonical.substring(0, canonical.lastIndexOf('/') + 1) + mapFile;
          try {
            var mapData = fs.readFileSync(toNative(mapCanonical), 'utf8');
            var mapBase64 = Buffer.from(mapData).toString('base64');
            source = source.replace(
              mapMatch[0],
              '//# sourceMappingURL=data:application/json;base64,' + mapBase64
            );
          } catch {}
        }
        return { format: format, source: source, shortCircuit: true };
      } catch {}
    }
    return nextLoad(url, context);
  }
});

// Import the real ESM entry (use canonicalToUrl for cross-platform snapshot URL)
var entryCanonical = '${snapshotify(entryAbsPath, '/').replace(/\\/g, '/')}';
var entryUrl = canonicalToUrl(entryCanonical);
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

function resolveCompressType(value?: 'brotli' | 'gzip'): CompressType {
  if (!value) return CompressType.None;
  switch (value) {
    case 'brotli': return CompressType.Brotli;
    case 'gzip': return CompressType.GZip;
    default: return CompressType.None;
  }
}

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
