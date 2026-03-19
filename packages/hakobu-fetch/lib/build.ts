import { createGunzip } from 'zlib';
import crypto from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import tar from 'tar-fs';

import { cachePath } from './places';
import { downloadUrl, hash, spawn } from './utils';
import { hostArch, hostPlatform } from './system';
import { log, wasReported } from './log';
import patchesJson from '../patches/patches.json';

const buildPath = path.resolve(
  process.env.HAKOBU_BUILD_PATH ||
    path.join(os.tmpdir(), `hakobu.${crypto.randomBytes(12).toString('hex')}`)
);
const nodePath = path.join(buildPath, 'node');
const patchesPath = path.resolve(__dirname, '../patches');

const nodeRepo = 'https://nodejs.org/dist';
const nodeArchivePath = path.join(cachePath, 'node');

function getMajor(nodeVersion: string) {
  const [, version] = nodeVersion.match(/^v?(\d+)/) || ['', 0];
  return Number(version) | 0;
}

// --- Platform-independent configure flags ---
// These flags apply to all Node 24 builds regardless of target platform.

// --- Platform-specific configure flags ---
// Flags that vary by target platform or host environment.

function getConfigureArgs(_major: number, targetPlatform: string, targetArch: string): string[] {
  const args: string[] = [];

  // Disable inspector — packaged apps don't support debugging against the
  // patched binary, and v8_inspector pulls in symbols that require newer
  // GLIBCXX on some systems.
  args.push('--without-inspector');

  // [platform-specific: alpine] Statically link libgcc and libstdc++.
  // Skip when target is linuxstatic since --fully-static supersedes this.
  if (hostPlatform === 'alpine' && targetPlatform !== 'linuxstatic') {
    args.push('--partly-static');
  }

  // [platform-specific: linuxstatic] Fully static binary.
  if (targetPlatform === 'linuxstatic') {
    args.push('--fully-static');
  }

  // LTO on all non-Windows platforms. Controlled by HAKOBU_ENABLE_LTO env var.
  // LTO significantly increases link time (30+ minutes) but produces smaller,
  // faster binaries. Defaults to off for faster CI iteration. Release builds
  // should set HAKOBU_ENABLE_LTO=1.
  if (hostPlatform !== 'win' && process.env.HAKOBU_ENABLE_LTO === '1') {
    args.push('--enable-lto');
  }

  // Production binaries do NOT take NODE_OPTIONS from end-users.
  args.push('--without-node-options');

  // DTrace/ETW support was removed in Node 19+. No flag needed for Node 24.

  // No bundled npm.
  args.push('--without-npm');

  // ICU configuration.
  // Node 24 on Windows uses full-icu via vcbuild.bat (see compileOnWindows).
  // All other platforms use small-icu.
  if (hostPlatform !== 'win') {
    args.push('--with-intl=small-icu');
  }

  // [platform-specific: macos] Use system zlib.
  if (targetPlatform === 'macos') {
    args.push('--shared-zlib');
  }

  // [platform-specific: macos] Cross-build from arm64 host to x64 target.
  if (targetPlatform === 'macos' && hostArch === 'arm64' && targetArch === 'x64') {
    args.push('--dest-os=mac');
    args.push('--dest-cpu=x64');
  }

  return args;
}

async function tarFetch(nodeVersion: string) {
  log.info('Fetching Node.js source archive from nodejs.org...');

  const distUrl = `${nodeRepo}/${nodeVersion}`;
  const tarName = `node-${nodeVersion}.tar.gz`;

  const archivePath = path.join(nodeArchivePath, tarName);
  const hashPath = path.join(nodeArchivePath, `${tarName}.sha256sum`);

  if (existsSync(hashPath) && existsSync(archivePath)) {
    return;
  }

  await rm(hashPath, { recursive: true, force: true }).catch(() => undefined);
  await rm(archivePath, { recursive: true, force: true }).catch(
    () => undefined
  );

  await downloadUrl(`${distUrl}/SHASUMS256.txt`, hashPath);

  await writeFile(
    hashPath,
    (await readFile(hashPath, 'utf8'))
      .split('\n')
      .filter((l) => l.includes(tarName))[0]
  );

  await downloadUrl(`${distUrl}/${tarName}`, archivePath);
}

async function tarExtract(nodeVersion: string, suppressTarOutput: boolean) {
  log.info('Extracting Node.js source archive...');

  const tarName = `node-${nodeVersion}.tar.gz`;

  const expectedHash = (
    await readFile(path.join(nodeArchivePath, `${tarName}.sha256sum`), 'utf8')
  ).split(' ')[0];
  const actualHash = await hash(path.join(nodeArchivePath, tarName));

  if (expectedHash !== actualHash) {
    await rm(path.join(nodeArchivePath, tarName), {
      recursive: true,
      force: true,
    });
    await rm(path.join(nodeArchivePath, `${tarName}.sha256sum`), {
      recursive: true,
      force: true,
    });
    throw wasReported(`Hash mismatch for ${tarName}`);
  }

  const pipe = promisify(pipeline);

  const source = createReadStream(path.join(nodeArchivePath, tarName));
  const gunzip = createGunzip();
  const extract = tar.extract(nodePath, {
    strip: 1,
    map: (header) => {
      if (!suppressTarOutput) {
        // disabled for now - can't get cmdline flag to work with all builds
        // log.info(header.name);
      }
      return header;
    },
  });

  await pipe(source, gunzip, extract);
}

async function applyPatches(nodeVersion: string) {
  log.info('Applying patches');

  const storedPatches = patchesJson[nodeVersion as keyof typeof patchesJson] as
    | string[]
    | { patches: string[] }
    | { sameAs: string };
  const storedPatch =
    'patches' in storedPatches ? storedPatches.patches : storedPatches;
  const patches =
    'sameAs' in storedPatch
      ? patchesJson[storedPatch.sameAs as keyof typeof patchesJson]
      : storedPatch;

  for (const patch of patches) {
    const patchPath = path.join(patchesPath, patch);
    const args = ['-p1', '-i', patchPath];
    await spawn('patch', args, { cwd: nodePath, stdio: 'inherit' });
  }
}

export async function fetchExtractApply(
  nodeVersion: string,
  quietExtraction: boolean
) {
  await tarFetch(nodeVersion);
  await tarExtract(nodeVersion, quietExtraction);
  await applyPatches(nodeVersion);
}

// --- Windows build (platform-specific) ---

async function compileOnWindows(
  nodeVersion: string,
  targetArch: string,
  targetPlatform: string
) {
  const args = ['/c', 'vcbuild.bat', targetArch];
  const major = getMajor(nodeVersion);
  const config_flags = getConfigureArgs(major, targetPlatform, targetArch);

  // ETW (Event Tracing for Windows) was removed in Node 19+. No flag needed.
  // Performance counters were removed in Node 11+. No flag needed.

  // Link Time Code Generation (Windows equivalent of LTO).
  // Controlled by HAKOBU_ENABLE_LTO for consistency with Unix LTO.
  if (process.env.HAKOBU_ENABLE_LTO === '1') {
    args.push('ltcg');
  }

  // Node 24 on Windows crashes with small-icu at icudat codegen.
  // Workaround: enable full-icu via vcbuild.bat.
  // TODO: check with newer node/tooling/gh-image versions
  args.push('full-icu');

  await spawn('cmd', args, {
    cwd: nodePath,
    env: { ...process.env, config_flags: config_flags.join(' ') },
    stdio: 'inherit',
  });

  // Node 11+ output path (always true for Node 24).
  return path.join(nodePath, 'out/Release/node.exe');
}

const { MAKE_JOB_COUNT = os.cpus().length } = process.env;

// --- Unix build (platform-specific) ---
// Handles Linux (glibc, static, alpine/musl), macOS, and FreeBSD.

async function compileOnUnix(
  nodeVersion: string,
  targetArch: string,
  targetPlatform: string
) {
  const args = [];
  const cpu = {
    x86: 'ia32',
    x64: 'x64',
    armv6: 'arm',
    armv7: 'arm',
    arm64: 'arm64',
    ppc64: 'ppc64',
    s390x: 's390x',
  }[targetArch];

  if (cpu) {
    args.push('--dest-cpu', cpu);
  }

  if (targetArch === 'armv7') {
    const { CFLAGS = '', CXXFLAGS = '' } = process.env;
    process.env.CFLAGS = `${CFLAGS} -marm -mcpu=cortex-a7 -mfpu=vfpv3`;
    process.env.CXXFLAGS = `${CXXFLAGS} -marm -mcpu=cortex-a7 -mfpu=vfpv3`;

    args.push('--with-arm-float-abi=hard');
    args.push('--with-arm-fpu=vfpv3');
  }
  // macos cross-build from arm64 to x64
  if (targetPlatform === "macos" && hostArch === 'arm64' && targetArch === 'x64') {
    const { CFLAGS = '', CXXFLAGS = '', LDFLAGS='' } = process.env;
    process.env.CFLAGS = `${CFLAGS} -arch x86_64`;
    process.env.CXXFLAGS = `${CXXFLAGS} -arch x86_64`;
    process.env.LDFLAGS = `${LDFLAGS} -arch x86_64`;
  }

  if (hostArch !== targetArch) {
    log.warn('Cross compiling!');
    log.warn('You are responsible for appropriate env like CC, CC_host, etc.');
    args.push('--cross-compiling');
  }

  args.push(...getConfigureArgs(getMajor(nodeVersion), targetPlatform, targetArch));

  log.info("Running configure with: ", args.join(" "));
  // TODO same for windows?
  await spawn('/bin/sh', ['./configure', ...args], {
    cwd: nodePath,
    stdio: 'inherit',
  });

  await spawn(
    hostPlatform === 'freebsd' ? 'gmake' : 'make',
    ['-j', String(MAKE_JOB_COUNT)],
    {
      cwd: nodePath,
      stdio: 'inherit',
    }
  );

  const output = path.join(nodePath, 'out/Release/node');

  await spawn(
    process.env.STRIP || 'strip',
    // global symbols are required for native bindings on macOS
    [...(targetPlatform === 'macos' ? ['-x'] : []), output],
    {
      stdio: 'inherit',
    }
  );

  if (targetPlatform === 'macos') {
    // Newer versions of Apple Clang automatically ad-hoc sign the compiled executable.
    // However, for final executable to be signable, base binary MUST NOT have an existing signature.
    await spawn('codesign', ['--remove-signature', output], {
      stdio: 'inherit',
    });
  }

  return output;
}

async function compile(
  nodeVersion: string,
  targetArch: string,
  targetPlatform: string
) {
  log.info('Compiling Node.js from sources...');
  const win = hostPlatform === 'win';

  if (win) {
    return compileOnWindows(nodeVersion, targetArch, targetPlatform);
  }

  return compileOnUnix(nodeVersion, targetArch, targetPlatform);
}

export async function prepBuildPath() {
  await rm(buildPath, { recursive: true, force: true });
  await mkdir(nodePath, { recursive: true });
  await mkdir(nodeArchivePath, { recursive: true });
}

export default async function build(
  nodeVersion: string,
  targetArch: string,
  targetPlatform: string,
  local: string
) {
  await prepBuildPath();
  await fetchExtractApply(nodeVersion, false);

  const output = await compile(nodeVersion, targetArch, targetPlatform);
  const outputHash = await hash(output);

  await mkdir(path.dirname(local), { recursive: true });
  await cp(output, local);
  await writeFile(
    `${local}.sha256sum`,
    `${outputHash}  ${path.basename(local)}
`
  );
  await rm(buildPath, { recursive: true, force: true });
}
