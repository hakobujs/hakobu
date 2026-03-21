/**
 * Hakobu diagnostic and inspection commands.
 *
 * These answer the questions developers ask before, during, and after packaging:
 *   - targets:  What can I build for? What base binaries are cached?
 *   - inspect:  What does Hakobu see in my project?
 *   - doctor:   Is my project ready to package? What's wrong?
 */

import fs from 'fs';
import path from 'path';
import { stat } from 'fs/promises';

import {
  need,
  system,
  getNodeVersion,
} from '@hakobu/hakobu-fetch';
// These are internal to hakobu-fetch but we import the compiled JS
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EXPECTED_HASHES } = require('@hakobu/hakobu-fetch/lib-es5/expected');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { localPlace } = require('@hakobu/hakobu-fetch/lib-es5/places');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetchPkg = require('@hakobu/hakobu-fetch/package.json');

import { analyze } from './analyzer';
import type { PackagingManifest, ManifestWarning } from './manifest';

const {
  hostArch,
  hostPlatform,
  knownArchs,
  knownPlatforms,
} = system;

// ─────────────────────────────────────────────────────────────────────
// Shared formatting
// ─────────────────────────────────────────────────────────────────────

function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function red(s: string) { return `\x1b[31m${s}\x1b[0m`; }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }

function severityIcon(s: string) {
  if (s === 'error') return red('x');
  if (s === 'warning') return yellow('!');
  return dim('i');
}

// ─────────────────────────────────────────────────────────────────────
// hakobu targets
// ─────────────────────────────────────────────────────────────────────

export async function commandTargets() {
  const nodeVersion = getNodeVersion('node24');
  const fetchVersion = fetchPkg.version;

  console.log(bold('Hakobu Targets'));
  console.log();

  // Host
  console.log(`  Host: ${bold(`${hostPlatform}-${hostArch}`)} (Node ${process.version})`);
  console.log(`  Base: Node ${nodeVersion}`);
  console.log();

  // Published targets from expected-shas.json
  const published: { platform: string; arch: string; name: string; cached: boolean }[] = [];

  for (const name of Object.keys(EXPECTED_HASHES)) {
    // name format: hakobu-base-v24.14.0-linux-x64
    const match = name.match(/^hakobu-base-(v[\d.]+)-([a-z]+)-([a-z0-9]+)$/);
    if (!match) continue;
    const [, , platform, arch] = match;

    // Check cache
    const cachedPath = localPlace({
      from: 'fetched',
      arch,
      nodeVersion,
      platform,
      version: fetchVersion,
    });

    let cached = false;
    try {
      const s = await stat(cachedPath);
      cached = s.size > 0;
    } catch { /* not cached */ }

    published.push({ platform, arch, name, cached });
  }

  // Sort: host target first, then alphabetical
  published.sort((a, b) => {
    const aIsHost = a.platform === hostPlatform && a.arch === hostArch;
    const bIsHost = b.platform === hostPlatform && b.arch === hostArch;
    if (aIsHost && !bIsHost) return -1;
    if (!aIsHost && bIsHost) return 1;
    return `${a.platform}-${a.arch}`.localeCompare(`${b.platform}-${b.arch}`);
  });

  console.log('  Published base binaries:');
  console.log();
  for (const t of published) {
    const isHost = t.platform === hostPlatform && t.arch === hostArch;
    const label = `${t.platform}-${t.arch}`;
    const hostTag = isHost ? dim(' (host)') : '';
    const cacheTag = t.cached ? green(' cached') : dim(' remote');
    console.log(`    ${t.cached ? green('*') : ' '} ${label}${hostTag}${cacheTag}`);
  }

  console.log();
  console.log(dim('  * = locally cached base binary'));
  console.log(dim(`  Cache: ${localPlace({ from: 'fetched', arch: 'x64', nodeVersion, platform: 'linux', version: fetchVersion }).replace(/fetched-.*$/, '')}`));
}

// ─────────────────────────────────────────────────────────────────────
// hakobu inspect <projectRoot>
// ─────────────────────────────────────────────────────────────────────

export async function commandInspect(projectRoot: string) {
  if (!projectRoot) {
    console.error(red('Usage: hakobu inspect <project-root>'));
    process.exit(1);
  }

  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    console.error(red(`Project root not found: ${resolved}`));
    process.exit(1);
  }

  console.log(bold('Hakobu Project Inspection'));
  console.log();
  console.log(`  Project: ${resolved}`);

  let manifest: PackagingManifest;
  try {
    manifest = await analyze({ projectRoot: resolved });
  } catch (err: any) {
    console.log();
    console.log(red(`  Analysis failed: ${err.message}`));
    if (err.remediation) {
      console.log(`  Remediation: ${err.remediation}`);
    }
    process.exit(1);
  }

  // Entry
  console.log();
  console.log(`  ${bold('Entry')}`);
  console.log(`    Path:      ${manifest.entry.snapshotPath}`);
  console.log(`    Format:    ${manifest.entry.format === 'esm' ? green('ESM') : 'CJS'}`);
  console.log(`    Detected:  ${manifest.entry.formatSource}`);

  // Files summary
  const files = Object.values(manifest.files);
  const byKind: Record<string, number> = {};
  for (const f of files) {
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  }

  console.log();
  console.log(`  ${bold('Files')} (${files.length} total)`);
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${kind}: ${count}`);
  }

  // Packages
  const pkgs = Object.values(manifest.packages);
  if (pkgs.length > 0) {
    console.log();
    console.log(`  ${bold('Packages')} (${pkgs.length})`);
    for (const pkg of pkgs.slice(0, 20)) {
      const name = pkg.name || dim('(unnamed)');
      const ver = pkg.version || '';
      const type = pkg.type === 'module' ? green('ESM') : 'CJS';
      console.log(`    ${name}${ver ? `@${ver}` : ''} ${dim(type)}`);
    }
    if (pkgs.length > 20) {
      console.log(dim(`    ... and ${pkgs.length - 20} more`));
    }
  }

  // Native addons
  if (manifest.nativeAddons.length > 0) {
    console.log();
    console.log(`  ${bold('Native Addons')} (${manifest.nativeAddons.length})`);
    for (const addon of manifest.nativeAddons) {
      console.log(`    ${addon.snapshotPath}`);
    }
  }

  // Externals
  if (manifest.externals.length > 0) {
    console.log();
    console.log(`  ${bold('External Artifacts')} (${manifest.externals.length})`);
    for (const ext of manifest.externals) {
      console.log(`    ${ext.name} ${ext.required ? red('required') : dim('optional')}`);
    }
  }

  // Warnings
  printWarnings(manifest.warnings);

  console.log();
}

// ─────────────────────────────────────────────────────────────────────
// hakobu doctor <projectRoot>
// ─────────────────────────────────────────────────────────────────────

export async function commandDoctor(projectRoot: string, targetSpec?: string) {
  if (!projectRoot) {
    console.error(red('Usage: hakobu doctor <project-root> [--target node24-macos-arm64]'));
    process.exit(1);
  }

  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved)) {
    console.error(red(`Project root not found: ${resolved}`));
    process.exit(1);
  }

  console.log(bold('Hakobu Doctor'));
  console.log();

  const checks: { name: string; status: 'ok' | 'warn' | 'fail'; detail: string }[] = [];

  // Check 1: Project root has package.json
  const pkgJsonPath = path.join(resolved, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    checks.push({
      name: 'package.json',
      status: 'ok',
      detail: `${pkg.name || '(unnamed)'}@${pkg.version || '0.0.0'}`,
    });
  } else {
    checks.push({
      name: 'package.json',
      status: 'fail',
      detail: 'Not found. Hakobu needs a package.json to determine the project name and entry.',
    });
  }

  // Check 2: Entrypoint exists
  let manifest: PackagingManifest | null = null;
  try {
    manifest = await analyze({ projectRoot: resolved });
    checks.push({
      name: 'Entrypoint',
      status: 'ok',
      detail: `${manifest.entry.snapshotPath} (${manifest.entry.format})`,
    });
  } catch (err: any) {
    checks.push({
      name: 'Entrypoint',
      status: 'fail',
      detail: err.message,
    });
  }

  // Check 3: Analysis warnings
  if (manifest) {
    const errors = manifest.warnings.filter(w => w.severity === 'error');
    const warns = manifest.warnings.filter(w => w.severity === 'warning');

    if (errors.length > 0) {
      checks.push({
        name: 'Analysis',
        status: 'fail',
        detail: `${errors.length} error(s): ${errors[0].message}`,
      });
    } else if (warns.length > 0) {
      checks.push({
        name: 'Analysis',
        status: 'warn',
        detail: `${warns.length} warning(s)`,
      });
    } else {
      checks.push({
        name: 'Analysis',
        status: 'ok',
        detail: `${Object.keys(manifest.files).length} files, no issues`,
      });
    }
  }

  // Check 4: Target base binary
  const target = parseTargetForDoctor(targetSpec);
  const nodeVersion = getNodeVersion('node24');
  const fetchVersion = fetchPkg.version;

  // Check if base is published
  const expectedName = `hakobu-base-${nodeVersion}-${target.platform}-${target.arch}`;
  const isPublished = !!EXPECTED_HASHES[expectedName];

  if (isPublished) {
    // Check if cached
    const cachedPath = localPlace({
      from: 'fetched',
      arch: target.arch,
      nodeVersion,
      platform: target.platform,
      version: fetchVersion,
    });

    let isCached = false;
    try {
      const s = await stat(cachedPath);
      isCached = s.size > 0;
    } catch { /* not cached */ }

    if (isCached) {
      checks.push({
        name: `Base binary (${target.platform}-${target.arch})`,
        status: 'ok',
        detail: `Cached at ${cachedPath}`,
      });
    } else {
      checks.push({
        name: `Base binary (${target.platform}-${target.arch})`,
        status: 'ok',
        detail: 'Available remotely (will be fetched during packaging)',
      });
    }
  } else {
    checks.push({
      name: `Base binary (${target.platform}-${target.arch})`,
      status: 'fail',
      detail: `No published base for ${target.platform}-${target.arch}. Available: ${Object.keys(EXPECTED_HASHES).map(n => n.replace(/^hakobu-base-v[\d.]+-/, '')).join(', ')}`,
    });
  }

  // Check 5: Native addons (if any)
  if (manifest && manifest.nativeAddons.length > 0) {
    if (target.platform !== hostPlatform || target.arch !== hostArch) {
      checks.push({
        name: 'Native addons',
        status: 'warn',
        detail: `${manifest.nativeAddons.length} native addon(s) detected. Cross-platform packaging of native addons requires rebuilding for the target.`,
      });
    } else {
      checks.push({
        name: 'Native addons',
        status: 'ok',
        detail: `${manifest.nativeAddons.length} addon(s) — host-target match`,
      });
    }
  }

  // Print results
  let hasFailure = false;
  for (const check of checks) {
    const icon = check.status === 'ok' ? green('OK') : check.status === 'warn' ? yellow('!!') : red('XX');
    console.log(`  ${icon}  ${check.name}`);
    console.log(`      ${check.detail}`);
    if (check.status === 'fail') hasFailure = true;
  }

  // Print manifest warnings if available
  if (manifest && manifest.warnings.length > 0) {
    printWarnings(manifest.warnings);
  }

  console.log();
  if (hasFailure) {
    console.log(red('  Some checks failed. Fix the issues above before packaging.'));
  } else {
    console.log(green('  All checks passed. Ready to package.'));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

function printWarnings(warnings: ManifestWarning[]) {
  if (warnings.length === 0) return;

  console.log();
  console.log(`  ${bold('Warnings')} (${warnings.length})`);
  for (const w of warnings) {
    console.log(`    ${severityIcon(w.severity)} [${w.category}] ${w.message}`);
    if (w.file) console.log(dim(`      in ${w.file}`));
    if (w.suggestion) console.log(dim(`      fix: ${w.suggestion}`));
  }
}

function parseTargetForDoctor(spec?: string): { platform: string; arch: string } {
  if (!spec) {
    return { platform: hostPlatform, arch: hostArch };
  }
  const parts = spec.split('-');
  let platform = hostPlatform;
  let arch = hostArch;
  for (const part of parts) {
    if (part.startsWith('node')) continue;
    if (knownPlatforms.includes(part)) platform = part;
    else if (knownArchs.includes(part)) arch = part;
  }
  return { platform, arch };
}
