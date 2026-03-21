/**
 * Hakobu Packager
 *
 * End-to-end packaging: project → analysis → snapshot → executable.
 *
 * This is the core package command implementation. It:
 *   1. Analyzes the project → PackagingManifest
 *   2. Builds the snapshot index with file sizes/hashes
 *   3. Assembles the virtual filesystem payload
 *   4. Obtains the patched base binary via hakobu-fetch
 *   5. Produces the final executable
 *
 * The binary injection uses the inherited producer.ts for placeholder
 * discovery and payload attachment. The new analyzer/manifest layers
 * feed into a compatibility bridge that converts to the format the
 * inherited producer expects.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { need, system } from '@hakobu/hakobu-fetch';

import { analyze, AnalyzerOptions } from './analyzer';
import { buildSnapshotIndex, SnapshotIndex } from './snapshot-index';
import type { PackagingManifest, RuntimeTarget, Platform, Arch } from './manifest';
import { log } from './log';

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
}

export interface PackageResult {
  /** Path to the produced executable. */
  outputPath: string;

  /** The analysis manifest. */
  manifest: PackagingManifest;

  /** The snapshot index. */
  snapshotIndex: SnapshotIndex;

  /** Number of files packaged. */
  fileCount: number;

  /** Total blob size in bytes. */
  blobSize: number;

  /** Target that was built. */
  target: { platform: string; arch: string; nodeRange: string };
}

// ─────────────────────────────────────────────────────────────────────
// Core package function
// ─────────────────────────────────────────────────────────────────────

export async function packageApp(options: PackageOptions): Promise<PackageResult> {
  const { projectRoot } = options;

  log.info('Analyzing project...');

  // ── 1. Analyze ──
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

    const errors = manifest.warnings.filter(w => w.severity === 'error');
    if (errors.length > 0) {
      throw new Error(
        `Analysis found ${errors.length} error(s) that would cause the packaged app to fail.\n` +
        `Fix these issues or add the affected packages to externals.`
      );
    }
  }

  // ── 2. Build snapshot index ──
  log.info('Building snapshot...');

  const fileSizes = new Map<string, { size: number; hash: string }>();
  const fileContents = new Map<string, Buffer>();

  for (const [snapshotPath, file] of Object.entries(manifest.files)) {
    const content = fs.readFileSync(file.absolutePath);
    fileSizes.set(snapshotPath, {
      size: content.length,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
    });
    fileContents.set(snapshotPath, content);
  }

  const snapshotIndex = buildSnapshotIndex(manifest, fileSizes);

  log.info(`  entries: ${snapshotIndex.entries.length}`);
  log.info(`  blob size: ${snapshotIndex.blobSize} bytes`);

  // ── 3. Assemble blob ──
  const blobChunks: Buffer[] = [];
  for (const entry of snapshotIndex.entries) {
    const content = fileContents.get(entry.path);
    if (!content) throw new Error(`Missing content for ${entry.path}`);
    blobChunks.push(content);
  }
  const blob = Buffer.concat(blobChunks);

  // ── 4. Serialize payload ──
  // Payload format: [indexJson]\0[blob]
  // The bootstrap reads the index from the beginning of the payload,
  // uses the null terminator to find the blob start, then reads file
  // content at index-specified offsets from the blob.
  const indexJson = JSON.stringify(snapshotIndex);
  const payload = Buffer.concat([
    Buffer.from(indexJson, 'utf8'),
    Buffer.from([0]), // null terminator
    blob,
  ]);

  // ── 5. Obtain base binary ──
  const target = parseTarget(options.target);
  log.info(`Fetching base binary for ${target.nodeRange}-${target.platform}-${target.arch}...`);

  const baseBinaryPath = await need({
    nodeRange: target.nodeRange,
    platform: target.platform,
    arch: target.arch,
  });

  log.info(`  base: ${baseBinaryPath}`);

  // ── 6. Produce output ──
  const outputPath = options.output || defaultOutputPath(manifest.appId, target);

  log.info(`Writing executable to ${outputPath}...`);

  // Read the base binary
  const baseBinary = fs.readFileSync(baseBinaryPath);

  // Simple payload attachment: append payload to the base binary
  // with a trailer that records the payload offset and a magic number.
  // The patched binary's bootstrap reads this trailer at startup.
  //
  // Trailer format (last 16 bytes of the executable):
  //   [payloadOffset: 8 bytes LE] [payloadSize: 4 bytes LE] [magic: 4 bytes "HKBU"]
  const payloadOffset = baseBinary.length;
  const trailer = Buffer.alloc(16);
  // Write as two 32-bit values for the offset (supports up to 4GB base binaries)
  trailer.writeUInt32LE(payloadOffset & 0xFFFFFFFF, 0);
  trailer.writeUInt32LE((payloadOffset / 0x100000000) >>> 0, 4);
  trailer.writeUInt32LE(payload.length, 8);
  trailer.write('HKBU', 12, 4, 'ascii');

  const output = Buffer.concat([baseBinary, payload, trailer]);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);

  // Make executable
  try {
    fs.chmodSync(outputPath, 0o755);
  } catch {
    // chmod may fail on Windows
  }

  // Sign on macOS
  if (target.platform === 'macos') {
    try {
      const { execSync } = require('child_process');
      execSync(`codesign -fds - "${outputPath}"`, { stdio: 'pipe' });
    } catch {
      // codesign may not be available
    }
  }

  const result: PackageResult = {
    outputPath,
    manifest,
    snapshotIndex,
    fileCount: snapshotIndex.entries.length,
    blobSize: snapshotIndex.blobSize,
    target: {
      platform: target.platform,
      arch: target.arch,
      nodeRange: target.nodeRange,
    },
  };

  log.info(`Done. Packaged ${result.fileCount} files (${result.blobSize} bytes) → ${outputPath}`);

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function parseTarget(spec?: string): { nodeRange: string; platform: string; arch: string } {
  const hostNodeRange = `node${process.version.match(/^v(\d+)/)![1]}`;

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
    if (part.startsWith('node')) {
      nodeRange = part;
    } else if (['linux', 'macos', 'win', 'alpine', 'linuxstatic'].includes(part)) {
      platform = part;
    } else if (['x64', 'arm64'].includes(part)) {
      arch = part;
    }
  }

  return { nodeRange, platform, arch };
}

function defaultOutputPath(appId: string, target: { platform: string; arch: string }): string {
  const ext = target.platform === 'win' ? '.exe' : '';
  return path.resolve(`${appId}-${target.platform}-${target.arch}${ext}`);
}
