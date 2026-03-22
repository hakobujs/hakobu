import { unlinkSync } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import semver from 'semver';

import { EXPECTED_HASHES } from './expected';
import {
  abiToNodeRange,
  hostPlatform, // eslint-disable-line no-duplicate-imports
  isValidNodeRange,
  knownArchs,
  toFancyArch,
  toFancyPlatform,
} from './system';
import * as system from './system';
import { localPlace, remotePlace, Remote } from './places';
import { log, wasReported } from './log';
import build from './build';
import { downloadUrl, hash, plusx, spawn } from './utils';
import patchesJson from '../patches/patches.json';
import { version } from '../package.json';

async function download(
  { tag, name }: Remote,
  local: string
): Promise<boolean> {
  const url = `https://github.com/hakobujs/hakobu/releases/download/${tag}/${name}`;

  try {
    await downloadUrl(url, local);
    await plusx(local);
  } catch {
    return false;
  }

  return true;
}

// macOS requires ad-hoc codesigning before a binary can execute.
// Base binaries are published unsigned (signature removed during build
// so the final packaged executable can be properly signed). We ad-hoc
// sign the cached copy after hash verification so it is immediately
// executable for verification and local use.
async function signIfNeeded(local: string) {
  if (hostPlatform === 'macos') {
    try {
      await spawn('codesign', ['-fds', '-', local], { stdio: 'pipe' });
    } catch {
      // non-fatal — binary may already be signed or on non-macOS
    }
  }
}

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    return false;
  }
}

interface NeedOptions {
  forceFetch?: boolean;
  forceBuild?: boolean;
  dryRun?: boolean;
  output?: string;
  nodeRange: string;
  platform: string;
  arch: string;
}

export function satisfyingNodeVersion(nodeRange: string) {
  const versions = Object.keys(patchesJson)
    .filter((nv) => semver.satisfies(nv, nodeRange) || nodeRange === 'latest')
    .sort((nv1, nv2) => (semver.gt(nv1, nv2) ? 1 : -1));

  const nodeVersion = versions.pop();

  if (!nodeVersion) {
    throw wasReported(`No available node version satisfies '${nodeRange}'`);
  }

  return nodeVersion;
}

export function getNodeVersion(nodeRange: string) {
  nodeRange = abiToNodeRange(nodeRange); // 'm48' -> 'node6'

  if (!isValidNodeRange(nodeRange)) {
    throw wasReported("nodeRange must start with 'node'");
  }

  if (nodeRange !== 'latest') {
    nodeRange = `v${nodeRange.slice(4)}`; // 'node6' -> 'v6' for semver
  }

  const nodeVersion = satisfyingNodeVersion(nodeRange);
  return nodeVersion;
}

export async function need(opts: NeedOptions) {
  // eslint-disable-line complexity
  const { forceFetch, forceBuild, dryRun, output, nodeRange } = opts || {};
  let { platform, arch } = opts || {};

  if (!nodeRange) throw wasReported('nodeRange not specified');
  if (!platform) throw wasReported('platform not specified');
  if (!arch) throw wasReported('arch not specified');

  platform = toFancyPlatform(platform); // win32 -> win
  arch = toFancyArch(arch); // ia32 -> x86

  const nodeVersion = getNodeVersion(nodeRange);

  const fetched = localPlace({
    from: 'fetched',
    arch,
    nodeVersion,
    platform,
    version,
    output,
  });
  const built = localPlace({
    from: 'built',
    arch,
    nodeVersion,
    platform,
    version,
    output,
  });
  const remote = remotePlace({ arch, nodeVersion, platform, version });
  const expectedHash = EXPECTED_HASHES[remote.name];

  const offline = !!process.env.HAKOBU_OFFLINE;
  let fetchFailed;

  if (offline && forceFetch) {
    throw wasReported('Cannot use --force-fetch in offline mode (HAKOBU_OFFLINE is set).');
  }

  if (forceFetch && !expectedHash) {
    throw wasReported(
      `No published checksum for '${remote.name}'. Build the base locally or set HAKOBU_NODE_PATH.`
    );
  }

  if (!forceBuild && !expectedHash && !dryRun) {
    log.info(
      `No published Hakobu base checksum for '${remote.name}'. Skipping remote fetch and falling back to local build.`
    );
  }

  // ── Check cached fetched binary ──
  if (!forceBuild && expectedHash) {
    if (await exists(fetched)) {
      if (dryRun) {
        return 'exists';
      }

      // Verify cached binary integrity before use
      if (process.env.HAKOBU_NODE_PATH) {
        // User-provided path — trust without hash check
        await signIfNeeded(fetched);
        return fetched;
      }

      const cachedHash = await hash(fetched);
      if (cachedHash === expectedHash) {
        await signIfNeeded(fetched);
        return fetched;
      }

      log.info('Binary hash does NOT match. Re-fetching...');
      unlinkSync(fetched);
    }
  }

  // ── Check cached built binary ──
  if (!forceFetch) {
    if (await exists(built)) {
      if (dryRun) return 'exists';

      // Verify built binary is not corrupted (valid Node binaries are >30MB)
      const builtStat = await stat(built);
      if (builtStat.size < 1024 * 1024) {
        log.info(
          `Built binary appears corrupted (${builtStat.size} bytes). Removing...`
        );
        unlinkSync(built);
      } else {
        if (forceBuild) log.info('Reusing base binaries built locally:', built);
        return built;
      }
    }
  }

  // ── Offline mode: no download or build from source ──
  if (offline) {
    throw wasReported(
      `Base binary not found in cache for ${platform}-${arch}.\n` +
      `HAKOBU_OFFLINE is set — cannot download or build.\n` +
      `Pre-populate the cache by running without HAKOBU_OFFLINE first, or copy\n` +
      `the base binary to: ${fetched}`
    );
  }

  if (!forceBuild && expectedHash) {
    if (dryRun) return 'fetched';

    if (await download(remote, fetched)) {
      if ((await hash(fetched)) === expectedHash) {
        await signIfNeeded(fetched);
        return fetched;
      }

      unlinkSync(fetched);
      throw wasReported('Binary hash does NOT match.');
    }

    fetchFailed = true;
  }

  if (!dryRun && fetchFailed) {
    log.info('Not found in remote cache:', JSON.stringify(remote));
    if (forceFetch) {
      throw wasReported(`Failed to fetch.`);
    }
  }

  if (!dryRun) {
    log.info('Building base binary from source:', path.basename(built));
  }

  if (hostPlatform !== platform) {
    if ((hostPlatform !== 'alpine' || platform !== 'linuxstatic') && arch !== 'ppc64') {
      throw wasReported(
        `Not able to build for '${opts.platform}' here, only for '${hostPlatform}'`
      );
    }
  }

  if (knownArchs.indexOf(arch) < 0) {
    throw wasReported(
      `Unknown arch '${opts.arch}'. Specify ${knownArchs.join(', ')}`
    );
  }

  if (dryRun) {
    return 'built';
  }

  await build(nodeVersion, arch, platform, built);
  return built;
}

export { system };
